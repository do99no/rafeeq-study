import { useSyncExternalStore } from 'react'
import type { CardType, Citation, Flashcard, MindNode, OutputData, QuestionType, QuizQuestion } from '../../types'
import { api } from '../server/account'
import { load, save } from '../storage/local'

/**
 * محتوى الدرس الجاهز: يجهّزه المسؤول مرة واحدة من صفحات الكتاب (نصاً وصوراً)، ويُحفظ في الخادم.
 * الطالب يقرؤه فوراً دون انتظار ودون استهلاك حصة الذكاء الاصطناعي.
 * كل بند مرتبط برقم مقطع [n] من الكتاب، والمقاطع المستشهد بها محفوظة في cites.
 */
export interface PackCite {
  n: number
  page: number
  chunk: number
  quote: string
  printed?: string
  ocr?: boolean
  weak?: boolean
}
export interface PackCheck {
  q: string
  answer: string
  options?: string[]
  n?: number
}
export interface PackStep {
  title: string
  text: string
  check?: PackCheck
}
export interface PackQuestion {
  type: QuestionType
  level: 'easy' | 'medium' | 'hard'
  q: string
  options?: string[]
  answer: string
  why: string
  n: number
  /** نتيجة لم تثبت بالحل المستقل: تحتاج مراجعة */
  flag?: string
}
/** نتيجة فحص الحزمة قبل اعتبار الدرس جاهزاً */
export interface PackReview {
  /** أدوات ناقصة أو أقل من الحد الأدنى */
  missing: string[]
  /** استشهادات أو إجابات غير صالحة */
  issues: string[]
  /** بنود عليها علامة «تحتاج مراجعة» */
  flagged: number
  /** كيف تُحقق من حلول المسائل */
  verified: 'independent' | 'none'
  at: number
}
export interface PackNode {
  label: string
  n?: number
  children?: PackNode[]
}
export interface LessonPack {
  v: 1
  bookId: string
  sectionId: string
  title: string
  bookTitle: string
  subject: string
  from: number
  to: number
  model: string
  at: number
  cites: PackCite[]
  /** صفحات قرأها النموذج من صورها، وصفحات لم يطّلع عليها (بلا نص ولم تُرفق) */
  seen: number[]
  unseen: number[]
  steps: PackStep[]
  summary: { full: string; short: string; final: string }
  guide: string
  terms: { term: string; def: string; n?: number }[]
  laws: { name: string; formula: string; meaning: string; n?: number }[]
  points: string[]
  mistakes: { mistake: string; fix: string; n?: number }[]
  mindmap?: PackNode
  qa: { q: string; a: string; n?: number; flag?: string }[]
  cards: { front: string; back: string; type: CardType; n: number; flag?: string }[]
  quiz: PackQuestion[]
  worksheet: { type: QuestionType; q: string; answer: string; n: number; flag?: string }[]
  review?: PackReview
  /** حالة المراجعة كما يحددها المسؤول */
  status?: 'ai' | 'reviewed' | 'hidden'
  updated?: number
}
export interface PackInfo {
  bookId: string
  sectionId: string
  title: string
  parts: string[]
  status: 'ai' | 'reviewed' | 'hidden'
  model: string
  updated: number
  size: number
}

// ===== التخزين على الجهاز (IndexedDB، فالمحتوى أكبر من التخزين المحلي): حزم كل كتاب، تُحدَّث حين تتغير في الخادم =====
type Entry = { at: number; lessons: Record<string, LessonPack> }
type Cache = Record<string, Entry>
let cache: Cache = {}
let index: PackInfo[] = load<PackInfo[]>('lesson-index') ?? []
let snap = { cache, index, ready: false }
const subs = new Set<() => void>()

let idb: Promise<IDBDatabase> | undefined
const open = () =>
  (idb ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('rafeeq-lessons', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('books')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const t = (await open()).transaction('books', mode)
  const req = fn(t.objectStore('books'))
  return new Promise((res, rej) => {
    t.oncomplete = () => res(req ? req.result : undefined)
    t.onerror = t.onabort = () => rej(t.error)
  })
}
/** يقرأ المخزَّن على الجهاز مرة واحدة عند التشغيل */
export const packsReady: Promise<void> = (async () => {
  try {
    const keys = (await store<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []
    const vals = (await store<Entry[]>('readonly', (s) => s.getAll())) ?? []
    cache = Object.fromEntries(keys.map((k, i) => [String(k), vals[i]]))
  } catch {
    cache = {}
  }
  snap = { cache, index, ready: true }
  subs.forEach((l) => l())
})()
const emit = () => {
  snap = { cache, index, ready: snap.ready }
  subs.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  subs.add(l)
  return () => void subs.delete(l)
}
export const usePacks = () => useSyncExternalStore(subscribe, () => snap)
export const packOf = (bookId: string, sectionId?: string) => (sectionId ? cache[bookId]?.lessons[sectionId] : undefined)

function persist(bookId: string) {
  // المساحة ممتلئة: يبقى المحتوى في الذاكرة لهذه الجلسة، ويُجلب من الخادم مرة أخرى لاحقاً
  const e = cache[bookId]
  void store<unknown>('readwrite', (s) => { if (e) s.put(e, bookId); else s.delete(bookId) }).catch(() => {})
}

let syncing: Promise<void> | undefined
/** يجلب فهرس الجاهز، ثم حزم كل كتاب تغيّر فيه شيء منذ آخر مرة */
export function syncPacks(bookIds?: string[]): Promise<void> {
  syncing ??= (async () => {
    await packsReady
    try {
      const r = await api<{ lessons: PackInfo[] }>('/lessons')
      index = r.lessons
      save('lesson-index', index)
      const latest = new Map<string, number>()
      for (const l of index) latest.set(l.bookId, Math.max(latest.get(l.bookId) ?? 0, l.updated))
      for (const [bookId, at] of latest) {
        if (bookIds && !bookIds.includes(bookId)) continue
        const have = Object.keys(cache[bookId]?.lessons ?? {}).length
        const want = index.filter((l) => l.bookId === bookId).length
        if (cache[bookId]?.at === at && have === want) continue
        const b = await api<{ lessons: LessonPack[] }>(`/lessons/${encodeURIComponent(bookId)}`)
        cache = { ...cache, [bookId]: { at, lessons: Object.fromEntries(b.lessons.map((p) => [p.sectionId, p])) } }
        persist(bookId)
        emit()
      }
      // ما حُذف أو أُخفي في الخادم يُحذف هنا
      for (const id of Object.keys(cache))
        if (!latest.has(id)) {
          const { [id]: _, ...rest } = cache
          cache = rest
          persist(id)
        }
      emit()
    } catch {
      // بلا اتصال: يبقى المخزَّن
    }
  })().finally(() => (syncing = undefined))
  return syncing
}

// ===== التحويل إلى أشكال العرض الموجودة (الملخص، الاختبار، البطاقات، الخريطة) =====
export function citeOf(p: LessonPack, n?: number): Citation | undefined {
  const c = n ? p.cites.find((x) => x.n === n) : undefined
  if (!c) return undefined
  return { n: c.n, bookId: p.bookId, bookTitle: p.bookTitle, page: c.page, printed: c.printed, section: p.title, quote: c.quote, chunk: c.chunk, ...(c.ocr ? { ocr: true } : {}), ...(c.weak ? { weak: true } : {}) }
}
/** نص فيه [n] مع استشهاداته */
export function textWithCites(p: LessonPack, text: string): { text: string; citations: Citation[] } {
  const used = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
  const citations = used.flatMap((n) => citeOf(p, n) ?? [])
  const ok = new Set(citations.map((c) => c.n))
  return { text: text.replace(/\[(\d+)\]/g, (m, n) => (ok.has(Number(n)) ? m : '')), citations }
}
const ref = (n?: number) => (n ? ` [${n}]` : '')

export type PackTool = 'explain' | 'full' | 'short' | 'final' | 'guide' | 'terms' | 'points' | 'mistakes' | 'qa' | 'mindmap' | 'cards' | 'quiz-easy' | 'quiz-medium' | 'quiz-hard' | 'worksheet'
export const PACK_TOOLS: { id: PackTool; label: string; group: 'read' | 'practice' }[] = [
  { id: 'explain', label: 'شرح الدرس كاملاً', group: 'read' },
  { id: 'full', label: 'ملخص شامل', group: 'read' },
  { id: 'short', label: 'ملخص سريع', group: 'read' },
  { id: 'final', label: 'ملخص ليلة الامتحان', group: 'read' },
  { id: 'guide', label: 'دليل الدراسة', group: 'read' },
  { id: 'terms', label: 'المصطلحات والقوانين', group: 'read' },
  { id: 'points', label: 'أهم النقاط', group: 'read' },
  { id: 'mistakes', label: 'أخطاء شائعة', group: 'read' },
  { id: 'mindmap', label: 'خريطة ذهنية', group: 'read' },
  { id: 'qa', label: 'سؤال وجواب', group: 'practice' },
  { id: 'cards', label: 'بطاقات المراجعة', group: 'practice' },
  { id: 'quiz-easy', label: 'اختبار سهل', group: 'practice' },
  { id: 'quiz-medium', label: 'اختبار متوسط', group: 'practice' },
  { id: 'quiz-hard', label: 'اختبار صعب', group: 'practice' },
  { id: 'worksheet', label: 'ورقة عمل', group: 'practice' },
]

/** هل في الحزمة محتوى لهذه الأداة */
export function hasTool(p: LessonPack, t: PackTool) {
  switch (t) {
    case 'explain': return p.steps.length > 0
    case 'full': case 'short': case 'final': return !!p.summary?.[t]
    case 'guide': return !!p.guide
    case 'terms': return p.terms.length + p.laws.length > 0
    case 'points': return p.points.length > 0
    case 'mistakes': return p.mistakes.length > 0
    case 'qa': return p.qa.length > 0
    case 'mindmap': return !!p.mindmap?.children?.length
    case 'cards': return p.cards.length > 0
    case 'worksheet': return p.worksheet.length > 0
    default: return p.quiz.some((q) => q.level === t.slice(5))
  }
}

export const explainText = (p: LessonPack) => p.steps.map((s, i) => `### ${i + 1}. ${s.title}\n${s.text}`).join('\n\n')

/** المخرج بصيغة العارض الموجود */
export function toolData(p: LessonPack, t: PackTool): OutputData {
  const text = (s: string) => ({ kind: 'summary' as const, ...textWithCites(p, s) })
  switch (t) {
    case 'explain': return text(explainText(p))
    case 'full': case 'short': case 'final': return text(p.summary[t])
    case 'guide': return text(p.guide)
    case 'terms': return text([
      p.terms.length ? `### المصطلحات والتعريفات\n${p.terms.map((x) => `- **${x.term}:** ${x.def}${ref(x.n)}`).join('\n')}` : '',
      p.laws.length ? `### القوانين والقواعد\n${p.laws.map((x) => `- **${x.name}:** ${x.formula ? `\`${x.formula}\` ` : ''}${x.meaning}${ref(x.n)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'))
    case 'points': return text(`### أهم ما تحفظه\n${p.points.map((x) => `- ${x}`).join('\n')}`)
    case 'mistakes': return text(`> نصائح من رفيق مبنية على محتوى الكتاب، وليست أسئلة امتحان.\n\n${p.mistakes.map((x) => `- **الخطأ:** ${x.mistake}\n  **الصواب:** ${x.fix}${ref(x.n)}`).join('\n')}`)
    case 'qa': return text(p.qa.map((x, i) => `**${i + 1}. ${x.q}**\n${x.a}${ref(x.n)}`).join('\n\n'))
    case 'mindmap': {
      const walk = (x: PackNode): MindNode => ({ label: x.label, ...(citeOf(p, x.n) ? { cite: citeOf(p, x.n) } : {}), ...(x.children?.length ? { children: x.children.map(walk) } : {}) })
      return { kind: 'mindmap', root: { ...walk(p.mindmap ?? { label: p.title }), label: p.title } }
    }
    case 'cards': return { kind: 'cards', known: [], cards: p.cards.map((c, i): Flashcard => ({ id: String(i + 1), front: c.front, back: c.back, type: c.type, cite: citeOf(p, c.n), ...(c.flag ? { flag: c.flag } : {}) })) }
    case 'worksheet': return {
      kind: 'quiz',
      meta: { mode: 'worksheet', subject: p.subject, lessons: [p.title] },
      questions: p.worksheet.flatMap((w): QuizQuestion[] => {
        const cite = citeOf(p, w.n)
        return cite ? [{ type: w.type, q: w.q, answer: w.answer, why: '', cite, origin: 'ورقة عمل من إعداد رفيق', ...(w.flag ? { flag: w.flag } : {}) }] : []
      }),
    }
    default: {
      const level = t.slice(5) as PackQuestion['level']
      return {
        kind: 'quiz',
        meta: { mode: 'exam', subject: p.subject, level, lessons: [p.title] },
        questions: p.quiz.filter((q) => q.level === level).flatMap((q): QuizQuestion[] => {
          const cite = citeOf(p, q.n)
          return cite ? [{ type: q.type, q: q.q, options: q.options, answer: q.answer, why: q.why, cite, ...(q.flag ? { flag: q.flag } : {}) }] : []
        }),
      }
    }
  }
}

/** الحد الأدنى لكل أداة كي يُعدّ الدرس جاهزاً */
export function reviewPack(p: LessonPack, verified: PackReview['verified'] = p.review?.verified ?? 'none'): PackReview {
  const missing: string[] = []
  const need = (ok: boolean, name: string) => !ok && missing.push(name)
  need(p.steps.length >= 2 && p.steps.every((s) => s.text.length > 80), 'الشرح')
  need(p.steps.filter((s) => s.check).length >= Math.min(2, p.steps.length), 'أسئلة الفهم في الشرح')
  need(!!p.summary.full && !!p.summary.short && !!p.summary.final, 'الملخصات')
  need(!!p.guide, 'دليل الدراسة')
  need(p.terms.length + p.laws.length >= 1, 'المصطلحات والقوانين')
  need(p.points.length >= 2, 'أهم النقاط')
  need(p.mistakes.length >= 1, 'الأخطاء الشائعة')
  need((p.mindmap?.children?.length ?? 0) >= 2, 'الخريطة الذهنية')
  need(p.qa.length >= 3, 'سؤال وجواب')
  need(p.cards.length >= 5, 'البطاقات')
  for (const [l, name] of [['easy', 'الاختبار السهل'], ['medium', 'الاختبار المتوسط'], ['hard', 'الاختبار الصعب']] as const) need(p.quiz.filter((q) => q.level === l).length >= 3, name)
  need(p.worksheet.length >= 3, 'ورقة العمل')
  const issues: string[] = []
  const cited = new Set(p.cites.map((c) => c.n))
  for (const c of p.cites) if (c.page < p.from || c.page > p.to) issues.push(`استشهاد [${c.n}] خارج صفحات الدرس (ص ${c.page})`)
  const texts = [...p.steps.map((s) => s.text), ...Object.values(p.summary), p.guide, ...p.points, ...p.qa.map((x) => x.a), ...p.terms.map((x) => x.def), ...p.mistakes.map((x) => x.fix)]
  for (const t of texts) for (const m of t.matchAll(/\[(\d+)\]/g)) if (!cited.has(Number(m[1]))) issues.push(`رقم استشهاد [${m[1]}] بلا مقطع`)
  for (const x of [...p.quiz, ...p.cards, ...p.worksheet]) if (!cited.has(x.n)) issues.push('بند بلا مصدر')
  for (const q of p.quiz) {
    if (q.type === 'mcq' && !q.options?.includes(q.answer)) issues.push('إجابة اختيار ليست بين الخيارات')
    if (q.type === 'tf' && !['صح', 'خطأ'].includes(q.answer)) issues.push('إجابة صح وخطأ غير صالحة')
  }
  const flagged = [...p.quiz, ...p.worksheet, ...p.cards, ...p.qa].filter((x) => x.flag).length
  return { missing, issues: [...new Set(issues)], flagged, verified, at: Date.now() }
}
export const packOk = (r?: PackReview) => !!r && !r.missing.length && !r.issues.length
