import { normalize, overlap } from '../../lib/arabic'
import type { CardType, QuestionType } from '../../types'
import { chat, Unavailable } from '../ai/manager'
import { getChunks } from '../books/db'
import type { Chunk, DocMeta, Section } from '../books/types'
import type { Hit } from '../rag/types'
import { api } from '../server/account'
import { cleanCites, passagesText } from './assistant'
import type { LessonPack, PackCite, PackNode, PackQuestion, PackStep } from './lessonPack'
import { pageImages } from './pages'
import { STRICT, subjectGuide, SYMBOLIC } from './prompts'

/**
 * تجهيز محتوى الدرس مسبقاً (من لوحة المسؤول): طلبان لكل درس، يقرأ فيهما النموذج نص الدرس وصور صفحاته.
 * لا يُقبل بند إلا إذا ارتبط بمقطع حقيقي من الدرس؛ وما لا يمكن التحقق منه يُحذف بدلاً من نشره.
 */
export interface Lesson {
  bookId: string
  bookTitle: string
  subject: string
  section: Section
}

/** الدروس الفعلية: كل قسم فرعي، والوحدة التي ليس تحتها دروس */
export function lessonsOf(sections: Section[]): Section[] {
  return sections.filter((s, i) => s.level === 2 || !(sections[i + 1]?.level === 2))
}

const BUDGET = 26_000
// أطول درس رياضيات ١٤ صفحة: كل صفحاته تُقرأ من صورها
const MAX_IMAGES = 16

function spread(hits: Hit[], budget: number) {
  const total = hits.reduce((s, h) => s + h.text.length, 0)
  if (total <= budget) return hits
  const n = Math.max(1, Math.floor((hits.length * budget) / total))
  return Array.from({ length: n }, (_, i) => hits[Math.floor((i * hits.length) / n)])
}

/** صفحات تُقرأ من صورها: الناقصة أولاً، ثم بلا نص، ثم المصوّرة في المواد الرمزية والدينية واللغوية */
function pagesToSee(chunks: Chunk[], doc: DocMeta, s: Section) {
  const inLesson = (p: number) => p >= s.page && p <= s.endPage
  const weak = [...new Set(chunks.filter((c) => c.weak).map((c) => c.page))]
  const bad = (doc.badPages ?? []).filter(inLesson)
  const ocr = [...new Set(chunks.filter((c) => c.ocr && !c.weak).map((c) => c.page))]
  // الصفحة بلا نص أولاً: لا مصدر لمحتواها غير صورتها
  const all = [...new Set([...bad, ...weak, ...ocr])]
  return { attach: all.slice(0, MAX_IMAGES).sort((a, b) => a - b), rest: all.slice(MAX_IMAGES), bad }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
function parseJson(raw: string): Record<string, unknown> | null {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    return JSON.parse(raw.slice(s, e + 1))
  } catch {
    return null
  }
}

async function ask(system: string, user: string, images: { url: string }[], note: string, signal: AbortSignal, onText?: (n: number) => void) {
  let text = ''
  let model = ''
  for (let attempt = 0; ; attempt++) {
    text = ''
    try {
      for await (const ev of chat([{ role: 'system', content: system }, { role: 'user', content: user, ...(images.length ? { images: images.map((i) => i.url), imagesNote: note } : {}) }], { maxTokens: 30000, signal })) {
        if (ev.type === 'provider') model = ev.name
        else if (ev.type === 'reset') text = ''
        else {
          text += ev.text
          onText?.(text.length)
        }
      }
      return { text, model }
    } catch (e) {
      const wait = e instanceof Unavailable && e.until ? e.until - Date.now() : 0
      if (signal.aborted || attempt > 1 || wait <= 0 || wait > 90_000) throw e
      await new Promise((r) => setTimeout(r, wait + 1000))
    }
  }
}

const TEACH = (title: string, symbolic: boolean, max: number) => `جهّز محتوى درس «${title}» لطالب الصف الثالث الثانوي، ليقرأه دون أن يسأل. أخرج JSON واحداً بهذا الشكل بالضبط:
{
 "steps": [{"title": "عنوان الفكرة", "text": "شرح تعليمي واضح للفكرة بفقرات قصيرة ونقاط، مع أرقام المقاطع [n]، ومثال من الكتاب مشروح${symbolic ? '، والمسائل المحلولة خطوة خطوة كل خطوة في سطر مع سببها' : ''}. توضيح أو تشبيه من عندك في سطر يبدأ بـ > وبلا رقم مقطع", "check": {"q": "سؤال فهم قصير عن هذه الفكرة", "answer": "إجابته من المقطع", "options": ["أربعة خيارات إن كان اختياراً، وإلا احذف هذا الحقل"], "src": 1}}],
 "summary": {"full": "ملخص شامل بعناوين ### ونقاط، رقم المقطع بعد كل نقطة", "short": "ملخص سريع للمراجعة في نقاط قليلة", "final": "ملخص ليلة الامتحان: أهم ما يُتذكر، التعريفات، القوانين، ما يكثر الخلط فيه"},
 "guide": "دليل دراسة: ### ماذا ستتعلم، ### ما يجب أن تفهمه، ### ما يجب أن تحفظه، ### كيف تذاكر هذا الدرس (خطوات عملية)، ### اختبر نفسك (أسئلة قصيرة بلا إجابات)",
 "terms": [{"term": "", "def": "التعريف كما في الكتاب", "src": 1}],
 "laws": [{"name": "اسم القانون أو القاعدة", "formula": "الصيغة كما في الكتاب أو فارغة", "meaning": "معنى الرموز ومتى يُستخدم", "src": 1}],
 "points": ["نقطة مهمة للحفظ [n]"],
 "mistakes": [{"mistake": "خطأ يقع فيه الطلاب", "fix": "الصواب كما في الكتاب", "src": 1}],
 "mindmap": {"label": "${title}", "children": [{"label": "فكرة رئيسية", "src": 1, "children": [{"label": "تفصيل قصير", "src": 1}]}]}
}
الشروط:
- steps من 3 إلى 8 أفكار متتالية تغطي الدرس كله بترتيبه في الكتاب، من الأساسيات إلى الأصعب. كل خطوة لا تزيد على 350 كلمة.
- "src" رقم المقطع (من 1 إلى ${max}) الذي أُخذت منه المعلومة، وليس رقم الخطوة أو السؤال. لا تكتب أرقام صفحات.
- لكل خطوة "check" إلزامي: سؤال فهم قصير وإجابته، والخيارات اختيارية.
- لا تكتب شيئاً ليس في المقاطع أو في صور الصفحات المرفقة، إلا التوضيحات في سطور >.
- القوانين والمعادلات بين علامتي \` \`، بلا LaTeX.${symbolic ? '\n- الأرقام والرموز والمعادلات انقلها من صور الصفحات فقط. ما لم تستطع قراءته بوضوح فلا تكتبه، وقل «راجع الصفحة».\n- تحقق بنفسك من صحة كل حل حسابي قبل كتابته: أعد التعويض في الناتج. إن وجدت في الكتاب ناتجاً يبدو خطأ فانقله كما هو واكتب بعده سطراً > فيه ملاحظتك.' : ''}
- احذف أي حقل لا يكفيه محتوى الدرس (مثلاً laws في درس بلا قوانين) بجعله قائمة فارغة.`

const PRACTICE = (title: string, symbolic: boolean, max: number) => `جهّز مواد التدريب لدرس «${title}» من المقاطع وصور الصفحات المرفقة. أخرج JSON واحداً بهذا الشكل بالضبط:
{
 "qa": [{"q": "سؤال مراجعة", "a": "إجابة نموذجية واضحة", "src": 1}],
 "cards": [{"type": "term|law|question|fact|example", "front": "المصطلح أو القانون أو السؤال فقط", "back": "التعريف أو الإجابة القصيرة", "src": 1}],
 "quiz": [{"level": "easy|medium|hard", "type": "mcq|tf|fill|short|reason${symbolic ? '|problem' : ''}", "q": "", "options": ["للاختيار فقط: أربعة خيارات"], "answer": "في الاختيار نص الخيار الصحيح حرفياً، وفي صح وخطأ: صح أو خطأ", "why": "لماذا هذه هي الإجابة", "src": 1}],
 "worksheet": [{"type": "short|reason|essay|fill${symbolic ? '|problem' : ''}", "q": "", "answer": "الإجابة النموذجية${symbolic ? ' (وفي المسائل خطوات الحل كاملة)' : ''}", "src": 1}]
}
الشروط:
- qa من 6 إلى 10، cards من 10 إلى 16، quiz 15 سؤالاً بالضبط: 5 سهلة (تذكر وفهم مباشر)، 5 متوسطة (فهم وتطبيق)، 5 صعبة (تطبيق وتحليل وربط)، وworksheet من 6 إلى 10 تمارين متنوعة.
- "src" رقم المقطع (من 1 إلى ${max}) الذي فيه الإجابة، وليس رقم السؤال؛ وكل إجابة واردة في ذلك المقطع أو في صورة صفحته. لا تخترع معلومات ولا تنسب سؤالاً إلى امتحان رسمي.
- في fill ضع ____ مكان الكلمة الناقصة.${symbolic ? '\n- المسائل (problem) بأرقام من عندك على قوانين واردة في الدرس، أو مسائل الكتاب نفسها. احسب الناتج بنفسك وتحقق منه بالتعويض قبل كتابته، واكتب خطوات الحل في answer. الأرقام في نص الكتاب المقروء آلياً غير موثوقة: خذها من صور الصفحات.' : ''}
- لا تكرر السؤال نفسه بصيغ مختلفة.`

export interface Progress {
  phase: string
  chars?: number
}

/** يجهّز درساً واحداً ويعيد الحزمة دون رفعها */
export async function prepareLesson(l: Lesson, doc: DocMeta, signal: AbortSignal, onProgress?: (p: Progress) => void): Promise<{ pack: LessonPack; dropped: number }> {
  const s = l.section
  const all = (await getChunks(l.bookId)).filter((c) => c.page >= s.page && c.page <= s.endPage && c.text.length > 30)
  const hits: Hit[] = spread(all.map((c) => ({ ...c, bookTitle: l.bookTitle, score: 0 })), BUDGET)
  const plan = pagesToSee(all, doc, s)
  onProgress?.({ phase: 'يرسم صور الصفحات' })
  const shots = await pageImages(plan.attach.map((page) => ({ bookId: l.bookId, page })))
  // صفحة بلا نص مقروء تصبح مقطعاً يُستشهد به، ومحتواه في صورتها
  for (const sh of shots)
    if (!hits.some((h) => h.page === sh.ref.page))
      hits.push({ bookId: l.bookId, i: -sh.ref.page, page: sh.ref.page, text: 'صفحة بلا نص مقروء آلياً: محتواها في صورتها المرفقة.', bookTitle: l.bookTitle, score: 0, ocr: true })
  hits.sort((a, b) => a.page - b.page || a.i - b.i)
  if (!hits.length) throw new Error('empty')
  const seenPages = shots.map((x) => x.ref.page)
  const note = `أُرفقت صور الصفحات الأصلية بالترتيب: ${shots.map((x) => `ص ${x.ref.page} (المقطع [${hits.findIndex((h) => h.page === x.ref.page) + 1}])`).join('، ')}. النص المقروء آلياً من هذه الصفحات قد تكون سقطت منه معادلات أو رموز أو رسوم أو تشكيل، فاقرأها من الصورة. ما تقرؤه من صورة صفحة يُستشهد له برقم مقطع تلك الصفحة.`
  const symbolic = SYMBOLIC.has(l.subject)
  const system = `${STRICT.replace('8. في هذه المهمة لا تضف شيئاً من خارج المقاطع، ولا تستخدم سطور >.', '8. التوضيحات والتشبيهات من عندك مسموحة فقط في سطور تبدأ بـ > وبلا أرقام مقاطع.')}\n${subjectGuide([l.subject])}\n9. أخرج JSON صالحاً فقط، دون أي نص قبله أو بعده، ودون \`\`\`.`
  const passages = `المقاطع من كتاب «${l.bookTitle}»، درس «${s.title}» (ص ${s.page}–${s.endPage}):\n\n${passagesText(hits)}\n\n---\n`

  const max = hits.length
  const valid = (v: unknown) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined
  }
  /** رقم المقطع من البند (src، أو n في الصيغة القديمة)؛ إن غاب أو خرج عن النطاق فأقرب مقطع بالمعنى */
  const nOf = (x: Record<string, unknown> | undefined, ...texts: unknown[]) => {
    const n = valid(x?.src ?? x?.n)
    if (n) return n
    const t = texts.map(str).join(' ')
    let best = 0
    let at: number | undefined
    hits.forEach((h, i) => {
      const o = overlap(t, h.text)
      if (o > best) [best, at] = [o, i + 1]
    })
    return best >= 0.25 ? at : undefined
  }
  const fromImage = (n: number) => seenPages.includes(hits[n - 1].page)
  /** البند مقبول إذا وُجد معناه في المقطع، أو كان المقطع صفحة قُرئت من صورتها */
  const grounded = (n: number | undefined, ...texts: string[]) => !!n && (fromImage(n) || texts.some((t) => t && overlap(t, hits[n - 1].text) >= 0.35))
  const clean = (t: unknown) => cleanCites(str(t), max).text
  let dropped = 0
  const keep = <T,>(list: T[], ok: (x: T) => boolean) => {
    const out = list.filter(ok)
    dropped += list.length - out.length
    return out
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [])

  // ١. الشرح والملخصات والمصطلحات
  let A: Record<string, unknown> | null = null
  let model = ''
  for (let i = 0; i < 2 && !A?.steps; i++) {
    onProgress?.({ phase: 'يكتب الشرح والملخصات' })
    const r = await ask(system, passages + TEACH(s.title, symbolic, hits.length), shots, note, signal, (chars) => onProgress?.({ phase: 'يكتب الشرح والملخصات', chars }))
    A = parseJson(r.text)
    model = r.model
  }
  if (!A) throw new Error('parse')
  const steps: PackStep[] = keep(arr(A.steps).map((x) => {
    const c = x.check as Record<string, unknown> | undefined
    const opts = Array.isArray(c?.options) ? [...new Set((c!.options as unknown[]).map(str))].filter(Boolean) : []
    const answer = str(c?.answer)
    // خيارات لا تطابق الإجابة: يبقى السؤال بإجابة حرة بدلاً من حذفه
    const hit = opts.length >= 3 ? opts.find((o) => normalize(o) === normalize(answer)) : undefined
    const cn = c ? nOf(c, c.q, answer) : undefined
    const check = c && str(c.q) && answer ? { q: str(c.q), answer: hit ?? answer, ...(hit ? { options: opts } : {}), ...(cn ? { n: cn } : {}) } : undefined
    return { title: str(x.title), text: clean(x.text), ...(check?.answer ? { check } : {}) }
  }), (x) => !!x.title && /\[\d+\]/.test(x.text))
  if (!steps.length) throw new Error('steps')
  const sum = (A.summary ?? {}) as Record<string, unknown>
  const walk = (v: unknown, depth: number): PackNode[] =>
    depth > 4 ? [] : arr(v).flatMap((o) => {
      const label = str(o.label)
      const n = nOf(o, o.label)
      const children = walk(o.children, depth + 1)
      if (!label || (!children.length && !grounded(n, label))) return []
      return [{ label, ...(n ? { n } : {}), ...(children.length ? { children } : {}) }]
    })
  const mind = A.mindmap as Record<string, unknown> | undefined

  // ٢. التدريب
  let B: Record<string, unknown> | null = null
  for (let i = 0; i < 2 && !B?.quiz; i++) {
    onProgress?.({ phase: 'يكتب الأسئلة والبطاقات' })
    const r = await ask(system, passages + PRACTICE(s.title, symbolic, hits.length), shots, note, signal, (chars) => onProgress?.({ phase: 'يكتب الأسئلة والبطاقات', chars }))
    B = parseJson(r.text)
  }
  const QT: QuestionType[] = ['mcq', 'tf', 'fill', 'short', 'reason', 'essay', 'problem']
  const quiz: PackQuestion[] = keep(arr(B?.quiz).map((o): PackQuestion | null => {
    const type = QT.find((t) => t === o.type)
    const level = (['easy', 'medium', 'hard'] as const).find((t) => t === o.level) ?? 'medium'
    const q = str(o.q)
    let answer = str(o.answer)
    const n = nOf(o, o.answer, o.q)
    if (!type || !q || !answer || !n || !grounded(n, answer, q)) return null
    let options: string[] | undefined
    if (type === 'mcq') {
      options = Array.isArray(o.options) ? [...new Set((o.options as unknown[]).map(str))].filter(Boolean) : []
      const hit = options.find((x) => normalize(x) === normalize(answer))
      if (options.length < 3 || !hit) return null
      answer = hit
      options = options.map((v) => ({ v, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.v)
    }
    if (type === 'tf') {
      if (!['صح', 'خطا'].includes(normalize(answer))) return null
      answer = normalize(answer) === 'صح' ? 'صح' : 'خطأ'
      options = ['صح', 'خطأ']
    }
    if (type === 'fill' && !/_{2,}|…|\.{3,}/.test(q)) return null
    return { type, level, q, ...(options ? { options } : {}), answer, why: clean(o.why), n }
  }).filter((x): x is PackQuestion => !!x), () => true)
  const CT: CardType[] = ['term', 'law', 'question', 'fact', 'example']

  const cited = new Set<number>()
  const pack: LessonPack = {
    v: 1, bookId: l.bookId, sectionId: s.id, title: s.title, bookTitle: l.bookTitle, subject: l.subject, from: s.page, to: s.endPage, model, at: Date.now(),
    cites: [], seen: seenPages, unseen: [...plan.bad.filter((p) => !seenPages.includes(p)), ...plan.rest].sort((a, b) => a - b),
    steps,
    summary: { full: clean(sum.full), short: clean(sum.short), final: clean(sum.final) },
    guide: clean(A.guide),
    terms: keep(arr(A.terms).map((x) => ({ term: str(x.term), def: clean(x.def), n: nOf(x, x.term, x.def) })), (x) => !!x.term && !!x.def && grounded(x.n, x.term, x.def)),
    laws: keep(arr(A.laws).map((x) => ({ name: str(x.name), formula: str(x.formula), meaning: clean(x.meaning), n: nOf(x, x.name, x.meaning) })), (x) => !!x.name && grounded(x.n, x.name, x.formula, x.meaning)),
    points: Array.isArray(A.points) ? (A.points as unknown[]).map(clean).filter((p) => /\[\d+\]/.test(p)) : [],
    mistakes: keep(arr(A.mistakes).map((x) => ({ mistake: str(x.mistake), fix: clean(x.fix), n: nOf(x, x.fix, x.mistake) })), (x) => !!x.mistake && !!x.fix && !!x.n),
    mindmap: mind ? { label: s.title, children: walk(mind.children, 1) } : undefined,
    qa: keep(arr(B?.qa).map((x) => ({ q: str(x.q), a: clean(x.a), n: nOf(x, x.a, x.q) })), (x) => !!x.q && !!x.a && grounded(x.n, x.a, x.q)),
    cards: keep(arr(B?.cards).map((x) => ({ front: str(x.front), back: str(x.back), type: CT.find((t) => t === x.type) ?? 'fact', n: nOf(x, x.back, x.front) ?? 0 })), (x) => !!x.front && !!x.back && grounded(x.n, x.front, x.back)),
    quiz,
    worksheet: keep(arr(B?.worksheet).map((x) => ({ type: QT.find((t) => t === x.type) ?? 'short', q: str(x.q), answer: clean(x.answer), n: nOf(x, x.answer, x.q) ?? 0 })), (x) => !!x.q && !!x.answer && grounded(x.n, x.answer, x.q)),
  }
  // المقاطع المستشهد بها فقط تُحفظ مع الحزمة
  const scan = (t: string) => [...t.matchAll(/\[(\d+)\]/g)].forEach((m) => cited.add(Number(m[1])))
  const mark = (n?: number) => n && cited.add(n)
  pack.steps.forEach((x) => (scan(x.text), mark(x.check?.n)))
  Object.values(pack.summary).forEach(scan)
  scan(pack.guide)
  pack.points.forEach(scan)
  ;[...pack.terms, ...pack.laws, ...pack.mistakes, ...pack.qa, ...pack.cards, ...pack.quiz, ...pack.worksheet].forEach((x) => mark(x.n))
  pack.qa.forEach((x) => scan(x.a))
  const walkMark = (x?: PackNode) => (x ? (mark(x.n), x.children?.forEach(walkMark)) : undefined)
  walkMark(pack.mindmap)
  pack.cites = [...cited].sort((a, b) => a - b).map((n): PackCite => {
    const h = hits[n - 1]
    return { n, page: h.page, chunk: h.i, quote: h.text.length > 360 ? `${h.text.slice(0, 360)}…` : h.text, ...(h.printed ? { printed: h.printed } : {}), ...(h.ocr ? { ocr: true } : {}), ...(h.weak ? { weak: true } : {}) }
  })
  return { pack, dropped }
}

export const uploadPack = (pack: LessonPack) => api<{ ok: boolean; parts: string[] }>(`/admin/lessons/${encodeURIComponent(pack.bookId)}/${encodeURIComponent(pack.sectionId)}`, { method: 'PUT', body: { pack } })
export const setPackStatus = (bookId: string, sectionId: string, status: 'ai' | 'reviewed' | 'hidden') =>
  api(`/admin/lessons/${encodeURIComponent(bookId)}/${encodeURIComponent(sectionId)}`, { method: 'PATCH', body: { status } })
