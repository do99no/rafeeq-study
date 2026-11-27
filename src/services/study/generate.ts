import type { CardType, Citation, Flashcard, MindNode, OutputData, QuestionType, QuizQuestion, Verdict } from '../../types'
import { normalize, overlap } from '../../lib/arabic'
import { chat, Unavailable } from '../ai/manager'
import { scopeChunks, search } from '../rag/search'
import type { Hit, Scope } from '../rag/types'
import { cleanCites, passagesText, toCitation } from './assistant'
import { getState } from '../../store/store'
import { STRICT, subjectGuide } from './prompts'

/** خطأ برسالة تُعرض للطالب كما هي */
export class StudyError extends Error {}

export type SummaryStyle = 'full' | 'short' | 'final' | 'defs' | 'laws' | 'points' | 'expected'
export const SUMMARY_STYLES: Record<SummaryStyle, { label: string; ask: string }> = {
  full: { label: 'تفصيلي', ask: 'اكتب ملخصاً تفصيلياً منظماً بعناوين ### ونقاط، يغطي كل الأفكار والتعريفات والأمثلة المهمة.' },
  short: { label: 'مختصر', ask: 'اكتب ملخصاً مختصراً لأهم الأفكار في نقاط قليلة تحت عناوين ###.' },
  final: { label: 'ليلة الامتحان', ask: 'اكتب ملخص ليلة الامتحان تحت عناوين ###: أهم ما يجب تذكره، والتعريفات الأساسية، والقوانين، وما يكثر الخلط فيه إن ورد في النص. كن مركزاً.' },
  defs: { label: 'التعريفات والمصطلحات', ask: 'استخرج التعريفات والمصطلحات الواردة فقط، كل تعريف في نقطة تبدأ بالمصطلح **عريضاً**.' },
  laws: { label: 'القوانين والمعادلات', ask: 'استخرج القوانين والمعادلات والقواعد الواردة فقط، كل قانون بين علامتي ` ` مع معنى رموزه ووحداته كما وردت. لا تصحح معادلة مشوهة من عندك؛ نبّه إليها.' },
  points: { label: 'نقاط الحفظ', ask: 'استخرج أهم ما يجب حفظه من حقائق وتصنيفات وأسماء وأرقام وخطوات واردة.' },
  expected: {
    label: 'أسئلة متوقعة للتدريب',
    ask: 'ابدأ بسطر: هذه أسئلة تدريبية من إعداد رفيق، وليست أسئلة امتحان حقيقية أو مضمونة. ثم تحت عنوان ### أسئلة للتدريب اكتب قائمة أسئلة مرقمة متنوعة (عرّف، علّل، قارن، اذكر، احسب إن ورد قانون)، وبعد كل سؤال سطر يبدأ بـ "- الإجابة:" مختصرة مع رقم المقطع.',
  },
}
export const QUESTION_TYPES: Record<QuestionType, string> = {
  mcq: 'اختيار من متعدد', tf: 'صح وخطأ', fill: 'أكمل', short: 'إجابة قصيرة', reason: 'تعليل وتفسير', essay: 'مقالية', problem: 'مسائل',
}
/** أسئلة تحتاج إلى تصحيح بالمعنى لا بالمطابقة */
export const OPEN_TYPES: QuestionType[] = ['short', 'reason', 'essay', 'problem']
export type CardKind = 'all' | 'terms' | 'laws' | 'questions' | 'facts'
export const CARD_KINDS: Record<CardKind, { label: string; ask: string }> = {
  all: { label: 'متنوعة', ask: 'مصطلحات وقوانين وأسئلة فهم وحقائق للحفظ، مع تحديد نوع كل بطاقة' },
  terms: { label: 'مصطلحات وتعريفات', ask: 'مصطلحات وتعريفات فقط (type: term)' },
  laws: { label: 'قوانين وقواعد', ask: 'قوانين ومعادلات وقواعد فقط (type: law)' },
  questions: { label: 'أسئلة فهم', ask: 'أسئلة فهم وتعليل قصيرة فقط (type: question)' },
  facts: { label: 'حقائق ومعلومات', ask: 'حقائق وأسماء وتواريخ وتصنيفات تحتاج إلى حفظ فقط (type: fact)' },
}
export const CARD_TYPES: Record<CardType, string> = { term: 'مصطلح', question: 'سؤال', law: 'قانون', fact: 'معلومة', example: 'مثال' }

const BATCH = 24_000
const MAX_BATCHES = 20

/** مهمة كاملة غير متدفقة؛ تنتظر إذا بلغ المزود حد الطلبات في الدقيقة */
/** مادة الكتب المعنية، ليتكيف المخرج مع طبيعتها */
const guideFor = (bookIds: string[]) => subjectGuide(bookIds.map((id) => getState().data.books.find((b) => b.id === id)?.subject))

async function complete(user: string, signal: AbortSignal, maxTokens = 6000, json = false, bookIds: string[] = []): Promise<string> {
  const guide = guideFor(bookIds)
  const base = guide ? `${STRICT}\n${guide}` : STRICT
  const system = json ? `${base}\n9. في هذه المهمة أخرج JSON صالحاً فقط، دون أي نص قبله أو بعده.` : base
  for (let attempt = 0; ; attempt++) {
    let text = ''
    try {
      for await (const ev of chat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens, signal })) {
        if (ev.type === 'reset') text = ''
        else if (ev.type === 'text') text += ev.text
      }
      return text
    } catch (e) {
      const wait = e instanceof Unavailable && e.until ? e.until - Date.now() : 0
      if (signal.aborted || attempt > 2 || wait <= 0 || wait > 70_000) throw e
      await new Promise((r) => setTimeout(r, wait + 500))
    }
  }
}

function parseJson(raw: string): unknown {
  const s = raw.search(/[[{]/)
  const e = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (s < 0 || e <= s) return null
  try {
    return JSON.parse(raw.slice(s, e + 1))
  } catch {
    return null
  }
}

/** توزيع متساوٍ على النطاق كله بدلاً من بدايته فقط */
function sample(hits: Hit[], budget = 16_000): Hit[] {
  const good = hits.filter((h) => h.text.length > 100)
  const pool = good.length ? good : hits
  const total = pool.reduce((s, h) => s + h.text.length, 0)
  if (total <= budget) return pool
  const n = Math.max(1, Math.floor((pool.length * budget) / total))
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)])
}

async function need(scope: Scope): Promise<Hit[]> {
  const hits = await scopeChunks(scope)
  if (!hits.length) throw new StudyError('لا يوجد نص مفهرس في هذا النطاق.')
  return hits
}

export async function makeSummary(scope: Scope, style: SummaryStyle, signal: AbortSignal, onProgress?: (d: number, t: number) => void): Promise<OutputData> {
  const hits = await need(scope)
  const batches: Hit[][] = [[]]
  let size = 0
  for (const h of hits) {
    if (size && size + h.text.length > BATCH) {
      batches.push([])
      size = 0
    }
    batches.at(-1)!.push(h)
    size += h.text.length
  }
  if (batches.length > MAX_BATCHES) throw new StudyError('هذا النطاق أكبر من أن يُلخَّص بدقة مرة واحدة. اختر وحدة أو دروساً أقل.')
  let start = 1
  const parts: string[] = []
  for (const [k, b] of batches.entries()) {
    onProgress?.(k + 1, batches.length)
    const part = batches.length > 1 ? `\nهذا الجزء ${k + 1} من ${batches.length}. لخص هذا الجزء وحده دون مقدمة أو خاتمة.` : ''
    const raw = await complete(`المقاطع:\n\n${passagesText(b, start)}\n\n---\n${SUMMARY_STYLES[style].ask} اذكر رقم المقطع بعد كل نقطة. إذا لم يرد شيء من المطلوب فاكتب ذلك.${part}`, signal, 6000, false, b.map((h) => h.bookId))
    const { text, used } = cleanCites(raw.trim(), start + b.length - 1)
    // استشهاد برقم من دفعة أخرى غير صالح
    if (used.some((n) => n >= start)) parts.push(text.replace(/\[(\d+)\]/g, (m, n) => (Number(n) >= start ? m : '')))
    else if (batches.length === 1) throw new StudyError('لم يقدّم المزود ملخصاً موثقاً بالمصادر. حاول مرة أخرى.')
    else parts.push('لم يتوفر ملخص موثق لهذا الجزء.')
    start += b.length
  }
  const text = parts.join('\n\n')
  const { used } = cleanCites(text, hits.length)
  if (!used.length) throw new StudyError('لم يقدّم المزود ملخصاً موثقاً بالمصادر. حاول مرة أخرى.')
  return { kind: 'summary', text, citations: used.map((n) => toCitation(hits[n - 1], n)) }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** البند يُقبل فقط إذا وُجد مقتطفه فعلاً في المقطع الذي نسبه إليه */
function grounded(item: Record<string, unknown>, hits: Hit[]) {
  const n = Number(item.n)
  const h = Number.isInteger(n) ? hits[n - 1] : undefined
  const quote = str(item.quote)
  if (!h || quote.length < 8) return null
  if (!normalize(h.text).includes(normalize(quote)) && overlap(quote, h.text) < 0.8) return null
  return { ...toCitation(h, 1), quote }
}

async function items<T>(ask: string, hits: Hit[], map: (o: Record<string, unknown>) => T | null, signal: AbortSignal): Promise<T[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = parseJson(await complete(`المقاطع:\n\n${passagesText(hits)}\n\n---\n${ask}`, signal, 7000, true, hits.map((h) => h.bookId)))
    const list = Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j).find(Array.isArray) : null
    const out = (list ?? []).flatMap((o: unknown) => (o && typeof o === 'object' ? (map(o as Record<string, unknown>) ?? []) : [])) as T[]
    if (out.length) return out
  }
  throw new StudyError('لم ينتج المزود بنوداً يمكن التحقق منها في الكتاب. حاول مرة أخرى أو غيّر النطاق.')
}

const COMMON = 'لكل عنصر: "n" رقم المقطع، و"quote" جملة قصيرة منسوخة حرفياً من المقطع نفسه تثبت الإجابة.'

export const LEVEL_ASK = { easy: 'أسئلة سهلة تقيس التذكر والفهم المباشر.', medium: 'أسئلة متوسطة تجمع الفهم والتطبيق.', hard: 'أسئلة أصعب: تطبيق وتحليل وتعليل وربط بين الأفكار، دون الخروج عن المقاطع.' } as const

export async function makeQuiz(scope: Scope, types: QuestionType[], count: number, signal: AbortSignal, level?: keyof typeof LEVEL_ASK): Promise<OutputData> {
  const hits = sample(await need(scope))
  const shapes: Record<QuestionType, string> = {
    mcq: '{"type":"mcq","q":"","options":["","","",""],"answer":"نص الخيار الصحيح حرفياً","why":"لماذا هو الصحيح ولماذا غيره خطأ","n":1,"quote":""}',
    tf: '{"type":"tf","q":"عبارة","answer":"صح أو خطأ","why":"التصحيح إن كانت خطأ","n":1,"quote":""}',
    fill: '{"type":"fill","q":"جملة فيها ____ واحدة","answer":"الكلمة الناقصة","why":"","n":1,"quote":""}',
    short: '{"type":"short","q":"","answer":"","why":"","n":1,"quote":""}',
    reason: '{"type":"reason","q":"علّل أو فسّر: ...","answer":"التعليل كما في المقطع","why":"","n":1,"quote":""}',
    essay: '{"type":"essay","q":"","answer":"إجابة نموذجية","why":"عناصر الإجابة","n":1,"quote":""}',
    problem: '{"type":"problem","q":"مسألة تطبق قانوناً وارداً في المقطع، بأرقام ووحدات","answer":"خطوات الحل: المعطيات، القانون، التعويض، الناتج بوحدته","why":"القانون المستخدم","n":1,"quote":"نص القانون من المقطع"}',
  }
  const ask = `${level ? LEVEL_ASK[level] + ' ' : ''}اكتب ${count} سؤالاً موزعة على المقاطع، من الأنواع التالية فقط:\n${types.map((t) => shapes[t]).join('\n')}\n${COMMON} كل إجابة يجب أن تكون واردة في المقطع${types.includes('problem') ? '، ولا تكتب مسألة إلا إذا ورد قانونها واضحاً في مقطع' : ''}. أخرج {"items":[...]}`
  const questions = await items<QuizQuestion>(ask, hits, (o) => {
    const type = o.type as QuestionType
    const q = str(o.q)
    let answer = str(o.answer)
    const cite = grounded(o, hits)
    if (!types.includes(type) || !q || !answer || !cite) return null
    let options: string[] | undefined
    if (type === 'mcq') {
      options = Array.isArray(o.options) ? [...new Set(o.options.map(str))].filter(Boolean) : []
      const hit = options.find((x) => normalize(x) === normalize(answer))
      if (options.length < 3 || !hit) return null
      answer = hit
      // ترتيب عشوائي: النماذج تميل إلى وضع الصحيح أولاً
      options = options.map((v) => ({ v, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.v)
    }
    if (type === 'tf') {
      if (!['صح', 'خطا'].includes(normalize(answer))) return null
      answer = normalize(answer) === 'صح' ? 'صح' : 'خطأ'
      options = ['صح', 'خطأ']
    }
    if (type === 'fill' && (!/_{2,}|…|\.{3,}/.test(q) || overlap(answer, `${cite.quote}\n${hits[Number(o.n) - 1].text}`) < 1)) return null
    return { type, q, options, answer, why: str(o.why), cite }
  }, signal)
  return { kind: 'quiz', questions: questions.slice(0, count) }
}

export async function makeCards(scope: Scope, kind: CardKind, count: number, signal: AbortSignal): Promise<OutputData> {
  const hits = sample(await need(scope))
  const ask = `اكتب ${count} بطاقة مراجعة: ${CARD_KINDS[kind].ask}. الشكل {"items":[{"type":"term|law|question|fact","front":"المصطلح أو القانون أو السؤال فقط","back":"التعريف أو الإجابة القصيرة من المقطع","extra":"شرح إضافي قصير، اختياري","example":"مثال من المقطع، اختياري","n":1,"quote":""}]}
لا تخلط الأنواع: الوجه الأول مصطلح أو قانون أو سؤال فقط، والوجه الآخر تعريفه أو إجابته فقط. ${COMMON}`
  const cards = await items<Flashcard>(ask, hits, (o) => {
    const cite = grounded(o, hits)
    const front = str(o.front)
    const back = str(o.back)
    const type = (['term', 'law', 'question', 'fact'] as CardType[]).find((t) => t === o.type) ?? 'fact'
    return cite && front && back ? { id: '', front, back, cite, type, ...(str(o.extra) ? { extra: str(o.extra) } : {}), ...(str(o.example) ? { example: str(o.example) } : {}) } : null
  }, signal)
  return { kind: 'cards', known: [], cards: cards.slice(0, count).map((c, i) => ({ ...c, id: String(i + 1) })) }
}

export async function makeMindmap(scope: Scope, title: string, signal: AbortSignal): Promise<OutputData> {
  const hits = sample(await need(scope))
  const ask = `ابنِ خريطة ذهنية للمقاطع: فروع رئيسية (الأفكار الرئيسية)، ثم فروع فرعية، ثم تفاصيل ومصطلحات قصيرة. إذا كانت بين فكرتين علاقة (سبب، نتيجة، نوع من، يقابل) فاكتبها في label الفرع الفرعي مثل «يؤدي إلى: …». الشكل {"children":[{"label":"","children":[{"label":"","n":1,"children":[{"label":"","n":1}]}]}]}. "n" رقم المقطع الذي ورد فيه العنصر. لا تضف ما ليس في المقاطع.`
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = parseJson(await complete(`المقاطع:\n\n${passagesText(hits)}\n\n---\n${ask}`, signal, 6000, true, hits.map((h) => h.bookId))) as { children?: unknown } | null
    const walk = (v: unknown, depth: number): MindNode[] =>
      !Array.isArray(v) || depth > 4
        ? []
        : v.flatMap((o) => {
            const label = str(o?.label)
            const h = hits[Number(o?.n) - 1]
            const children = walk(o?.children, depth + 1)
            // الورقة بلا مصدر حقيقي تُحذف
            if (!label || (!children.length && (!h || overlap(label, h.text) < 0.5))) return []
            return [{ label, ...(h ? { cite: toCitation(h, 1) } : {}), ...(children.length ? { children } : {}) }]
          })
    const children = walk(j?.children, 1)
    if (children.length) return { kind: 'mindmap', root: { label: title, children } }
  }
  throw new StudyError('لم ينتج المزود خريطة يمكن التحقق منها في الكتاب. حاول مرة أخرى أو غيّر النطاق.')
}

export interface Side {
  topic: string
  scope: Scope
}
export async function makeCompare(a: Side, b: Side, signal: AbortSignal): Promise<OutputData> {
  const get = async (s: Side) => (s.topic ? (await search(s.topic, s.scope, signal, 6)).hits : sample(await need(s.scope), 7000))
  const [ha, hb] = [await get(a), await get(b)]
  if (!ha.length || !hb.length) throw new StudyError(`لم أجد في المصادر ما يكفي عن «${(!ha.length ? a : b).topic}».`)
  const hits = [...new Map([...ha, ...hb].map((h) => [`${h.bookId}#${h.i}`, h])).values()]
  const name = (s: Side, i: string) => s.topic || i
  const raw = await complete(`المقاطع:\n\n${passagesText(hits)}\n\n---\nقارن بين «${name(a, `الموضوع الأول (المقاطع 1 إلى ${ha.length})`)}» و«${name(b, `الموضوع الثاني (المقاطع من ${ha.length + 1})`)}». اكتب جدول مقارنة Markdown: العمود الأول «وجه المقارنة» ثم عمود لكل طرف، وفي كل خلية رقم المقطع. ثم ### أوجه التشابه في نقاط مع أرقام المقاطع. لا تضف ما ليس في المقاطع.`, signal, 6000, false, hits.map((h) => h.bookId))
  const { text, used } = cleanCites(raw.trim(), hits.length)
  if (!used.length) throw new StudyError('لم يقدّم المزود مقارنة موثقة بالمصادر. حاول مرة أخرى.')
  return { kind: 'compare', text, citations: used.map((n) => toCitation(hits[n - 1], n)) }
}

/** تصحيح إجابة مفتوحة بالمعنى، مع شرح الخطأ ومرجع الكتاب */
export async function gradeAnswer(q: QuizQuestion, given: string, signal: AbortSignal): Promise<{ verdict: Verdict; text: string; cite: Citation }> {
  const raw = await complete(
    `المقطع [1]:\n${q.cite.quote}\n\n---\nالسؤال: ${q.q}\nالإجابة النموذجية: ${q.answer}\nإجابة الطالب: ${given}\n\nصحّح إجابة الطالب. السطر الأول بالضبط: «الحكم: صحيحة» أو «الحكم: صحيحة جزئياً» أو «الحكم: خاطئة». ثم في جمل قليلة: ما الصحيح فيما كتب، وما الخطأ أو الناقص ولماذا، ثم الإجابة الصحيحة [1]. اختلاف الصياغة مع صحة المعنى ليس خطأ.`,
    signal,
    1200,
    false,
    [q.cite.bookId],
  )
  const first = normalize(raw.split('\n').find((l) => l.trim()) ?? '').replace(/ئ/g, 'ي')
  const verdict: Verdict = /جزي/.test(first) ? 'partial' : /خاطي|خاطئ|غير صحيح/.test(first) ? 'wrong' : /صحيح/.test(first) ? 'correct' : 'partial'
  return { verdict, text: cleanCites(raw.replace(/^[^\n]*الحكم[^\n]*\n?/, '').trim(), 1).text, cite: q.cite }
}

/** شرح خطأ الطالب في سؤال اختيار أو صح وخطأ */
export async function explainMistake(q: QuizQuestion, given: string, signal: AbortSignal): Promise<string> {
  const raw = await complete(
    `المقطع [1]:\n${q.cite.quote}\n\n---\nالسؤال: ${q.q}${q.options ? `\nالخيارات: ${q.options.join(' | ')}` : ''}\nالإجابة الصحيحة: ${q.answer}\nإجابة الطالب: ${given}\n\nاشرح للطالب بلطف وفي جمل قليلة لماذا إجابته غير صحيحة، ولماذا الصحيحة صحيحة [1]، وكيف يميّز بينهما مستقبلاً.`,
    signal,
    900,
    false,
    [q.cite.bookId],
  )
  return cleanCites(raw.trim(), 1).text
}
