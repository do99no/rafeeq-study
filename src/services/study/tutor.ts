import type { Focus, Level, Message, Task, Verdict } from '../../types'
import { chat, Unavailable, visionReady } from '../ai/manager'
import type { ChatMsg } from '../ai/types'
import type { DocMeta } from '../books/types'
import { chunksByRef, scopeChunks, search, textSearch } from '../rag/search'
import type { Hit, Scope } from '../rag/types'
import { cleanCites, passagesText, toCitation } from './assistant'
import { SUMMARY_STYLES, type SummaryStyle } from './generate'
import { classify, LESSON_TASKS, norm, topicOf } from './intent'
import { pageImages, planPages, type PagePlan, type PageRef } from './pages'
import { errataNote, errataOf } from '../../data/errata'
import { getState } from '../../store/store'
import { imagesNote, LEVELS, subjectGuide, SYMBOLIC, TASKS, TUTOR } from './prompts'

export interface Ctx {
  /** المصادر المفعلة في الدفتر */
  bookIds: string[]
  focus?: Focus
  docs: Record<string, DocMeta>
  level: Level
  titleOf: (bookId: string) => string
  /** مادة الكتاب، ليتكيف الشرح مع طبيعتها */
  subjectOf?: (bookId: string) => string | undefined
}
export interface Ask {
  text: string
  task?: Task
  /** رقم الجزء عند متابعة شرح درس طويل أو التعليم خطوة بخطوة */
  part?: number
  /** فقرات حددها الطالب من الكتاب */
  basis?: { bookId: string; i: number }[]
  /** رسالة سؤال الفهم التي يجيب عنها الطالب */
  grade?: Message
}
export type TutorEvent =
  | { type: 'text'; text: string }
  | { type: 'reset' }
  | { type: 'status'; text: string }
  /** وُجد الدرس المطلوب بالاسم: يصبح هو الدرس الحالي */
  | { type: 'focus'; focus: Focus }
  | { type: 'done'; message: Omit<Message, 'id' | 'role' | 'createdAt'> }

/** حجم الجزء: الشرح الكامل يقرأ أجزاء كبيرة، والتعليم خطوة بخطوة فكرة صغيرة كل مرة */
const PART: Partial<Record<Task, number>> = { explain: 22_000, teach: 3_200 }
const BUDGET = 30_000
/** عدد صور الصفحات المرفقة في كل مهمة */
const IMAGES: Partial<Record<Task, number>> = { explain: 3, teach: 2, steps: 4, examples: 3, answer: 3, check: 2, grade: 1, compare: 2, summary: 2, points: 2, terms: 1, mistakes: 1 }
// النماذج الحديثة «تفكّر» قبل الرد ويُحتسب تفكيرها من الحد، فالحدود أعلى من طول الرد نفسه
const MAX_TOKENS: Partial<Record<Task, number>> = { explain: 12000, teach: 4000, check: 2000, grade: 2500, summary: 9000, points: 7000, mistakes: 6000, terms: 5000, compare: 6000, steps: 10000, examples: 9000, answer: 9000 }

const scopeOf = (f: Focus): Scope => ({ bookIds: [f.bookId], pages: { bookId: f.bookId, from: f.from, to: f.to } })
const key = (h: Hit) => `${h.bookId}#${h.i}`
const uniq = (hits: Hit[]) => [...new Map(hits.map((h) => [key(h), h])).values()]

/** يقسم مقاطع الدرس إلى أجزاء متتالية لا يتجاوز كل منها الحد */
export function parts(hits: Hit[], size: number): Hit[][] {
  const out: Hit[][] = [[]]
  let n = 0
  for (const h of hits) {
    if (n && n + h.text.length > size) {
      out.push([])
      n = 0
    }
    out.at(-1)!.push(h)
    n += h.text.length
  }
  return out.filter((p) => p.length)
}
/** توزيع متساوٍ على الدرس حين يكون أطول من الحد */
function spread(hits: Hit[], budget: number) {
  const total = hits.reduce((s, h) => s + h.text.length, 0)
  if (total <= budget) return hits
  const n = Math.max(1, Math.floor((hits.length * budget) / total))
  return Array.from({ length: n }, (_, i) => hits[Math.floor((i * hits.length) / n)])
}

/** يجد درساً من الفهرس باسمه، مثل «الحرارة النوعية» */
export function findLesson(topic: string, ctx: Ctx): Focus | undefined {
  const words = topic.split(' ').filter((w) => w.length > 2)
  if (!words.length) return undefined
  let best: { f: Focus; score: number } | undefined
  for (const id of ctx.bookIds)
    for (const s of ctx.docs[id]?.sections ?? []) {
      const t = norm(s.title)
      const score = words.filter((w) => t.includes(w)).length / words.length
      if (score >= 0.6 && (!best || score > best.score || (score === best.score && s.level === 2)))
        best = { score, f: { bookId: id, from: s.page, to: s.endPage, title: s.title, sectionId: s.id } }
    }
  return best?.f
}

async function lessonChunks(f: Focus) {
  return (await scopeChunks(scopeOf(f))).filter((h) => h.text.length > 40)
}

/** بحث في الدرس الحالي أولاً، ثم في كل المصادر */
async function find(q: string, ctx: Ctx, signal: AbortSignal, limit = 8): Promise<Hit[]> {
  if (ctx.focus && ctx.bookIds.includes(ctx.focus.bookId)) {
    const inLesson = (await search(q, scopeOf(ctx.focus), signal, limit)).hits
    if (inLesson.length >= 2) return inLesson
  }
  return (await search(q, { bookIds: ctx.bookIds }, signal, limit)).hits
}

const summaryStyle = (t: string): SummaryStyle => {
  const n = norm(t)
  return /مختصر|قصير|سريع/.test(n) ? 'short' : /ليله الامتحان|مراجعه نهاييه|قبل الامتحان/.test(n) ? 'final' : /تعريفات/.test(n) ? 'defs' : /قوانين|معادلات/.test(n) ? 'laws' : 'full'
}

/** يفصل سؤال الفهم عن نص الرد */
export function splitCheck(text: string) {
  const m = text.match(/\n?[\s*#>-]*سؤال الفهم[\s*]*[:：]\s*([\s\S]+?)\n[\s*#>-]*الإجابة النموذجية[\s*]*[:：]\s*([\s\S]+?)(?:\n[\s*#>-]*المقطع[\s*]*[:：]\s*\[?([\d٠-٩]+)\]?[^\n]*)?\s*$/)
  if (!m) return { body: text.trim() }
  const n = m[3] ? Number(m[3].replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x660))) : undefined
  return { body: text.slice(0, m.index).trim(), q: m[1].replace(/\*\*/g, '').trim(), answer: m[2].replace(/\*\*/g, '').trim(), n }
}
/** ما يظهر أثناء البث: يُخفى سؤال الفهم وإجابته النموذجية */
export const streamView = (t: string) => t.split(/[\s*#>-]*سؤال الفهم/)[0].replace(/\s?[[【][\d٠-٩,،\s]*[\]】]?/g, '')

const verdictOf = (t: string): Verdict | undefined => {
  const line = norm(t.split('\n').find((l) => l.trim()) ?? '')
  if (!/الحكم/.test(line)) return undefined
  return /جزيي/.test(line) ? 'partial' : /خاطي|غير صحيح/.test(line) ? 'wrong' : /صحيح/.test(line) ? 'correct' : undefined
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

/** تعريف بالمحادثة يرسل للنموذج: آخر الرسائل مع أسئلة الفهم */
function historyMsgs(history: Message[]): ChatMsg[] {
  return history
    .filter((m) => m.mode !== 'search' && m.mode !== 'none')
    .slice(-6)
    .map((m) => ({ role: m.role, content: `${m.text.replace(/\[\d+\]/g, '').slice(0, 1500)}${m.check ? `\nسؤال الفهم: ${m.check.q}` : ''}` }))
}

function unavailableText(e: Unavailable) {
  return e.reason === 'unset' ? 'خدمة الذكاء الاصطناعي لم تُفعَّل بعد، فلا أستطيع الشرح أو التصحيح الآن.' : 'خدمات الذكاء الاصطناعي غير متاحة الآن (انتهت الحصة أو تعذّر الاتصال).'
}

export async function* respond(ask: Ask, history: Message[], ctx: Ctx, signal: AbortSignal): AsyncGenerator<TutorEvent> {
  let task: Task = ask.grade ? 'grade' : (ask.task ?? classify(ask.text))
  const topic = topicOf(ask.text)
  let focus = ctx.focus && ctx.bookIds.includes(ctx.focus.bookId) ? ctx.focus : undefined
  let hits: Hit[] = []
  let part: { k: number; n: number } | undefined
  let instruction = ''
  const asked = history.flatMap((m) => (m.check ? [m.check.q] : [])).slice(-8)
  let lessonBased = false

  // درس مذكور بالاسم يصبح الدرس الحالي
  // فقط في النص الحر الذي يسمّي درساً، لا في أزرار المتابعة
  const names = !ask.task && /(^|\s)(درس|الدرس|فصل|الفصل|وحده|الوحده|باب|الباب|موضوع)\s+(?!هذا|هذه)\S{3,}/.test(norm(ask.text))
  if (LESSON_TASKS.includes(task) && !ask.basis && names && topic && !(focus && norm(focus.title).includes(topic))) {
    const named = findLesson(topic, ctx)
    if (named) {
      focus = named
      yield { type: 'focus', focus: named }
    } else focus = undefined
  }

  if (ask.grade) {
    hits = await chunksByRef(ask.grade.basis ?? [])
    const c = ask.grade.check!
    instruction = TASKS.grade(c.q, c.answer, ask.text)
  } else if (ask.basis?.length) {
    // فقرة محددة من الكتاب مع ما حولها لفهم السياق
    const pinned = await chunksByRef(ask.basis)
    const around = await chunksByRef(ask.basis.flatMap((b) => [{ bookId: b.bookId, i: b.i - 1 }, { bookId: b.bookId, i: b.i + 1 }]))
    hits = uniq([...pinned, ...around])
    instruction = task === 'check' ? TASKS.check(asked) : `${TASKS.answer(ask.text)}\nالطالب حدّد الفقرة [1] من الكتاب، والمقاطع التالية لها سياق فقط.${task === 'examples' ? `\n${TASKS.examples(ask.text)}` : task === 'steps' ? `\n${TASKS.steps(ask.text)}` : task === 'terms' ? `\n${TASKS.terms()}` : ''}`
  } else if (LESSON_TASKS.includes(task)) {
    if (!focus) {
      if (task === 'teach' || !topic) {
        yield { type: 'done', message: { task, mode: 'none', text: 'اختر الدرس أولاً من «أدرس الآن» أعلى المحادثة، أو اكتب اسمه، مثل: اشرح لي درس الحرارة النوعية.' } }
        return
      }
      hits = await find(topic, ctx, signal, 10)
    } else {
      const all = await lessonChunks(focus)
      if (!all.length) {
        yield { type: 'done', message: { task, mode: 'none', text: `لا يوجد نص مقروء في «${focus.title}». افتح صفحاته في القارئ، أو اختر درساً آخر.` } }
        return
      }
      const size = PART[task]
      if (size) {
        const list = parts(all, size)
        const k = Math.min(Math.max(1, ask.part ?? 1), list.length)
        part = { k, n: list.length }
        hits = list[k - 1]
      } else hits = spread(all, BUDGET)
    }
    const title = focus?.title ?? topic
    instruction =
      task === 'explain' ? TASKS.explain(title, part?.k ?? 1, part?.n ?? 1)
        : task === 'teach' ? TASKS.teach(title, part?.k ?? 1, part?.n ?? 1)
          : task === 'summary' ? TASKS.summary(SUMMARY_STYLES[summaryStyle(ask.text)].ask)
            : task === 'points' ? TASKS.points()
              : task === 'mistakes' ? TASKS.mistakes()
                : TASKS.terms()
  } else if (task === 'check') {
    if (focus && (!topic || norm(focus.title).includes(topic))) {
      // يدور على الدرس كله: كل سؤال من موضع تالٍ
      const all = await lessonChunks(focus)
      const start = all.length ? (asked.length * 3) % all.length : 0
      hits = all.slice(start, start + 3)
    } else if (topic) hits = await find(topic, ctx, signal, 4)
    else hits = await chunksByRef(history.findLast((m) => m.role === 'assistant' && m.basis?.length)?.basis ?? [])
    if (!hits.length) {
      yield { type: 'done', message: { task, mode: 'none', text: 'اختر درساً من «أدرس الآن» لأختبرك فيه، أو اكتب الموضوع، مثل: اختبرني في الأحماض.' } }
      return
    }
    instruction = TASKS.check(asked)
  } else if (task === 'compare') {
    const m = ask.text.match(/بين\s+(.+?)\s+و\s*(.+?)[؟?.]*$/)
    hits = m ? uniq([...(await find(m[1], ctx, signal, 5)), ...(await find(m[2], ctx, signal, 5))]) : await find(ask.text, ctx, signal, 10)
    instruction = TASKS.compare(ask.text)
  } else {
    // سؤال أو متابعة: الرد القصير مثل «أعطني مثالاً» يعتمد على مقاطع الرد السابق
    const short = topic.split(' ').filter(Boolean).length <= 2
    const prior = short ? await chunksByRef(history.findLast((m) => m.role === 'assistant' && m.basis?.length)?.basis ?? []) : []
    const found = prior.length >= 2 && short ? [] : await find(short && history.length ? `${history.findLast((m) => m.role === 'user')?.text ?? ''} ${ask.text}` : ask.text, ctx, signal)
    hits = uniq([...prior, ...found]).slice(0, 10)
    // درس مفتوح: سؤال بالرموز والأرقام لا يطابقه البحث في نص مقروء آلياً، فالمرجع صفحات الدرس نفسه وصورها
    if (focus) {
      const inLesson = hits.filter((h) => h.bookId === focus!.bookId && h.page >= focus!.from && h.page <= focus!.to)
      if (inLesson.length < 2) {
        hits = uniq([...inLesson, ...spread(await lessonChunks(focus), 14_000), ...hits]).slice(0, 14)
        lessonBased = true
      }
    }
    instruction = task === 'examples' ? TASKS.examples(ask.text) : task === 'steps' ? TASKS.steps(ask.text) : TASKS.answer(ask.text)
    if (!hits.length) {
      const near = (await textSearch(ask.text, { bookIds: ctx.bookIds }, 3)).hits
      yield {
        type: 'done',
        message: {
          task, mode: 'none',
          text: near.length
            ? 'لم أجد هذا في مصادرك المحددة. هذه أقرب المواضع، وقد لا تكون مرتبطة بسؤالك: ' + near.map((_, i) => `[${i + 1}]`).join('')
            : 'لم أجد هذا في مصادرك المحددة. جرّب كلمات من الكتاب، أو اختر الدرس من «أدرس الآن».',
          citations: near.map((h, i) => toCitation(h, i + 1)),
        },
      }
      return
    }
  }
  if (!hits.length) {
    yield { type: 'done', message: { task, mode: 'none', text: 'لم أجد نصاً مقروءاً لهذا الطلب في مصادرك.' } }
    return
  }

  const where = focus ? `\nالطالب يدرس الآن: «${focus.title}» من كتاب «${ctx.titleOf(focus.bookId)}».` : ''
  // نقاط ضعف الطالب في هذا الدرس (من تحديد المستوى والاختبارات): يتابعها المدرّس دون أن يطيل
  const slips = focus ? getState().data.mistakes.filter((m) => !m.resolved && m.bookId === focus!.bookId && m.page >= focus!.from && m.page <= focus!.to).slice(0, 3) : []
  const weakNote = slips.length ? `\nأخطأ الطالب سابقاً في هذا الدرس في: ${slips.map((m) => `«${m.q.slice(0, 140)}» (الصحيح: ${m.answer.slice(0, 80)})`).join('؛ ')}. انتبه لهذه النقاط في شرحك وأسئلتك حين يناسب، دون أن تكشف إجابة سؤال تطرحه.` : ''
  const guide = subjectGuide([focus?.bookId, ...hits.map((h) => h.bookId)].map((id) => (id ? ctx.subjectOf?.(id) : undefined)))

  // صفحات سقطت منها معادلات أو رسوم، وصفحات من الدرس بلا نص: تُرفق صورها لمزود يقرأ الصور
  const range = focus && (LESSON_TASKS.includes(task) || task === 'check' || lessonBased) && !ask.basis ? { bookId: focus.bookId, from: focus.from, to: focus.to } : undefined
  const plan = planPages(hits, ctx.docs, (await visionReady()) ? (IMAGES[task] ?? 2) : 0, range, (id) => SYMBOLIC.has(ctx.subjectOf?.(id) ?? ''))
  const shots = plan.attach.length ? await pageImages(plan.attach) : []
  // صفحة بلا نص تصبح مقطعاً يُستشهد به، ومحتواه في صورتها
  for (const s of shots)
    if (!hits.some((h) => h.bookId === s.ref.bookId && h.page === s.ref.page))
      hits.push({ bookId: s.ref.bookId, i: -1, page: s.ref.page, text: 'صفحة بلا نص مقروء آلياً: محتواها في صورتها المرفقة.', bookTitle: ctx.titleOf(s.ref.bookId), score: 0, lesson: focus?.title, ocr: true })
  const noteList = shots.map((s) => `ص ${s.ref.page} (المقطع [${hits.findIndex((h) => h.bookId === s.ref.bookId && h.page === s.ref.page) + 1}])`)
  const left = plan.unread.filter((p) => !shots.some((s) => s.ref.page === p.page && s.ref.bookId === p.bookId))
  const unreadNote = left.length ? `\nصفحات من الدرس بلا نص مقروء: ${left.map((p) => p.page).join('، ')}. لا تتحدث عن محتواها، ونبّه الطالب إلى فتحها في القارئ.` : ''
  let sent = false
  // أخطاء موثقة في الكتاب نفسه، في صفحات المقاطع أو الدرس
  const fixes = errataNote([...new Set([...hits.flatMap((h) => errataOf(h.bookId, h.page)), ...(focus ? errataOf(focus.bookId, focus.from, focus.to) : [])])])

  const messages: ChatMsg[] = [
    { role: 'system', content: `${TUTOR}${guide ? `\n${guide}` : ''}\n${LEVELS[ctx.level].ask}${where}${weakNote}${fixes ? `\n${fixes}` : ''}` },
    ...historyMsgs(history),
    {
      role: 'user',
      content: `المقاطع:\n\n${passagesText(hits)}\n\n---\n${instruction}${unreadNote}`,
      ...(shots.length ? { images: shots.map((s) => s.url), imagesNote: imagesNote(noteList) } : {}),
    },
  ]

  let text = ''
  let provider = ''
  const done = (): TutorEvent => {
    const split = task === 'teach' || task === 'check' ? splitCheck(text) : { body: text.trim() }
    const c = cleanCites(split.body, hits.length)
    const basis = hits.map((h) => ({ bookId: h.bookId, i: h.i }))
    const message: Omit<Message, 'id' | 'role' | 'createdAt'> = {
      task, mode: 'ai', provider, text: c.text, citations: c.used.map((n) => toCitation(hits[n - 1], n)), basis: basis.filter((b) => b.i >= 0), ...(part ? { part } : {}),
      ...pagesOf(plan, sent ? shots.map((s) => s.ref) : []),
    }
    if ('q' in split && split.q) {
      const h = split.n && hits[split.n - 1] ? hits[split.n - 1] : hits[0]
      message.check = { q: split.q, answer: split.answer!, cite: toCitation(h, 1) }
    }
    if (task === 'grade') {
      message.verdict = verdictOf(text)
      message.text = c.text.replace(/^[^\n]*الحكم[^\n]*\n?/, '').trim()
    }
    return { type: 'done', message }
  }

  for (let attempt = 0; ; attempt++) {
    let started = false
    try {
      for await (const ev of chat(messages, { signal, maxTokens: MAX_TOKENS[task] ?? 4000 })) {
        if (ev.type === 'provider') {
          provider = ev.name
          sent = ev.images
        }
        else if (ev.type === 'reset') {
          text = ''
          yield { type: 'reset' }
        } else {
          started = true
          text += ev.text
          yield { type: 'text', text: ev.text }
        }
      }
      yield done()
      return
    } catch (e) {
      if (signal.aborted) {
        if (text.trim()) yield done()
        return
      }
      if (!(e instanceof Unavailable)) throw e
      // حد الطلبات في الدقيقة: ننتظر مرة واحدة بدلاً من الفشل
      const wait = e.until ? e.until - Date.now() : 0
      if (!started && attempt === 0 && wait > 0 && wait < 70_000) {
        yield { type: 'status', text: `الخدمة مشغولة، أنتظر ${Math.ceil(wait / 1000)} ثانية ثم أكمل…` }
        await sleep(wait + 500, signal)
        if (signal.aborted) return
        continue
      }
      yield fallback(task, hits.filter((h) => h.i >= 0), e, ask, pagesOf(plan, []))
      return
    }
  }
}

/** ما قرأه رفيق من صور الصفحات فعلاً، وما بقي على الطالب أن يفتحه بنفسه */
function pagesOf(plan: PagePlan, seen: PageRef[]): Pick<Message, 'pages'> {
  const has = (p: PageRef) => seen.some((x) => x.bookId === p.bookId && x.page === p.page)
  const pages = { seen, unread: plan.unread.filter((p) => !has(p)), partial: [...plan.partial, ...plan.attach.filter((p) => !has(p) && !plan.unread.some((u) => u.page === p.page && u.bookId === p.bookId))].filter((p) => !has(p)) }
  return pages.seen.length || pages.unread.length || pages.partial.length ? { pages } : {}
}

/** دون ذكاء اصطناعي: نصوص الكتاب نفسها، مع توضيح ما تعذّر */
function fallback(task: Task, hits: Hit[], e: Unavailable, ask: Ask, pages: Pick<Message, 'pages'>): TutorEvent {
  const why = unavailableText(e)
  if (task === 'grade' && ask.grade?.check)
    return { type: 'done', message: { task, mode: 'search', text: `${why}\n\n**الإجابة النموذجية:** ${ask.grade.check.answer}\n\nقارنها بإجابتك، ثم حدّد النتيجة بنفسك.`, citations: ask.grade.check.cite ? [{ ...ask.grade.check.cite, n: 1 }] : [] } }
  if (task === 'check') return { type: 'done', message: { task, mode: 'search', text: `${why} يمكنك التدرب باختبار محفوظ من صفحة المراجعة.` } }
  const top = hits.slice(0, LESSON_TASKS.includes(task) ? 3 : 4)
  const lead = LESSON_TASKS.includes(task) ? `${why} هذه بداية الدرس من كتابك كما وردت:` : `${why} هذه أقرب الفقرات من كتبك كما وردت:`
  return {
    type: 'done',
    message: { ...pages, task: 'search', mode: 'search', text: `${lead}\n\n${top.map((h, i) => `${h.text.replace(/\n/g, ' ').slice(0, 600)} [${i + 1}]`).join('\n\n')}`, citations: top.map((h, i) => toCitation(h, i + 1)) },
  }
}
