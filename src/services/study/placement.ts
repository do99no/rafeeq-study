import { overlap, tokens } from '../../lib/arabic'
import { ERRATA } from '../../data/errata'
import { PLACEMENT_REVIEW } from '../../data/placementReview'
import type { Section } from '../books/types'
import { api } from '../server/account'
import type { LessonPack, PackInfo } from './lessonPack'
import { reviewVersion } from './verify'

/**
 * اختبار تحديد المستوى. الأسئلة من حزم الدروس الجاهزة فقط (من الكتب السودانية في المكتبة)، وكل سؤال:
 * موضوعي (اختيار من متعدد أو صح وخطأ)، غير موسوم «تحتاج مراجعة»، ومقطعه في الكتاب موجود، وإجابته واردة
 * في المقطع (أو متحقق منها بحل مستقل في الرياضيات)، وليس من صفحة فيها خطأ موثق في الكتاب، ثم روجع واحداً واحداً
 * (src/data/placementReview.ts). الإجابات تبقى في الخادم حتى يسلّم الطالب كل اختبارات مواده.
 */

// ===== ما يراه الطالب =====
export interface PlacementSubject {
  subject: string
  state: 'new' | 'active' | 'submitted'
  n: number
  minutes: number
  answered: number
  elapsed: number
  submitted?: number
}
export interface PlacementItem {
  id: string
  q: string
  options: string[]
  type: 'mcq' | 'tf'
  level: 'easy' | 'medium' | 'hard'
  unit?: string
}
export interface PlacementExam {
  subject: string
  state: 'active' | 'submitted'
  minutes: number
  elapsed: number
  answers: Record<string, number | null>
  items: PlacementItem[]
}
export interface ResultItem extends PlacementItem {
  skill?: string
  given: number | null
  correct: number
  ok: boolean
  why: string
  quote: string
  page: number
  printed?: string
  book: string
  bookId: string
  sectionId: string
  lesson: string
}
export interface SubjectResult {
  subject: string
  total: number
  correct: number
  wrong: number
  blank: number
  percent: number
  elapsed: number
  minutes: number
  submitted: number
  items: ResultItem[]
}
export interface PlacementOverview {
  journey: { started: number; completed: number | null; subjects: PlacementSubject[] } | null
  extra: PlacementSubject[]
  pending: string[]
  results: SubjectResult[]
}

const enc = encodeURIComponent
export const placementOverview = () => api<PlacementOverview>('/placement')
export const startPlacement = (subject: string) => api<PlacementExam>(`/placement/${enc(subject)}/start`, { method: 'POST', body: {} })
export const savePlacement = (subject: string, answers: Record<string, number | null>, elapsed: number) => api<{ ok: boolean; elapsed: number }>(`/placement/${enc(subject)}/answers`, { method: 'PUT', body: { answers, elapsed } })
export const submitPlacement = (subject: string, answers: Record<string, number | null>, elapsed: number) => api<{ ok: boolean }>(`/placement/${enc(subject)}/submit`, { method: 'POST', body: { answers, elapsed } })

/** حجم الاختبار ووقته لكل مادة: بقدر حجم المنهج وطبيعته (المسائل تحتاج وقتاً أطول) */
export const PLAN_OF: Record<string, { n: number; minutes: number }> = {
  الرياضيات: { n: 30, minutes: 60 },
  الفيزياء: { n: 20, minutes: 40 },
  الكيمياء: { n: 20, minutes: 35 },
  الأحياء: { n: 20, minutes: 25 },
  'العلوم الهندسية': { n: 20, minutes: 40 },
  'اللغة العربية': { n: 20, minutes: 25 },
  'اللغة الإنجليزية': { n: 20, minutes: 25 },
  'التربية الإسلامية': { n: 16, minutes: 20 },
}

// ===== تحليل النتيجة: ما أتقنه، وما أخفق فيه، ومن أين يبدأ =====
export type Mastery = 'mastered' | 'partial' | 'weak'
export interface UnitReport {
  unit: string
  total: number
  correct: number
  state: Mastery
  /** أخطأ في سؤال سهل: ضعف في الأساسيات */
  basics: boolean
  lessons: { bookId: string; sectionId: string; lesson: string; ok: boolean; level: string }[]
}
export interface SubjectAnalysis {
  subject: string
  percent: number
  level: 'تأسيس' | 'متوسط' | 'متقدم'
  levelNote: string
  units: UnitReport[]
  byLevel: Record<'easy' | 'medium' | 'hard', { total: number; correct: number }>
  strengths: string[]
  weaknesses: string[]
  /** أول درس يبدأ منه: أقدم درس في المنهج أخطأ فيه */
  start?: { bookId: string; sectionId: string; lesson: string; book: string }
}
const LEVEL_AR = { easy: 'السهلة', medium: 'المتوسطة', hard: 'الصعبة' } as const

export function analyze(r: SubjectResult): SubjectAnalysis {
  const byLevel = { easy: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, hard: { total: 0, correct: 0 } }
  const units = new Map<string, UnitReport>()
  for (const x of r.items) {
    byLevel[x.level].total++
    if (x.ok) byLevel[x.level].correct++
    const key = x.unit || x.book
    const u = units.get(key) ?? { unit: key, total: 0, correct: 0, state: 'weak' as Mastery, basics: false, lessons: [] }
    u.total++
    if (x.ok) u.correct++
    else if (x.level === 'easy') u.basics = true
    u.lessons.push({ bookId: x.bookId, sectionId: x.sectionId, lesson: x.lesson, ok: x.ok, level: x.level })
    units.set(key, u)
  }
  for (const u of units.values()) u.state = u.correct === u.total ? 'mastered' : u.correct / u.total >= 0.5 && !u.basics ? 'partial' : 'weak'
  const rate = (l: keyof typeof byLevel) => (byLevel[l].total ? byLevel[l].correct / byLevel[l].total : 1)
  const level = rate('easy') < 0.6 || r.percent < 45 ? 'تأسيس' : rate('hard') >= 0.6 && r.percent >= 75 ? 'متقدم' : 'متوسط'
  const levelNote =
    level === 'تأسيس'
      ? 'ابدأ من أساسيات المادة: شرح الدرس كاملاً وخطوة بخطوة، ثم الاختبار السهل قبل الانتقال.'
      : level === 'متوسط'
        ? 'أساسياتك جيدة: ركّز على الدروس التي أخطأت فيها، وتدرّب على الأسئلة المتوسطة والصعبة.'
        : 'مستواك متقدم: راجع ما أخطأت فيه بسرعة، وانتقل إلى الأسئلة الصعبة ومحاكاة الامتحان.'
  const list = [...units.values()]
  const wrong = r.items.filter((x) => !x.ok)
  return {
    subject: r.subject,
    percent: r.percent,
    level,
    levelNote,
    units: list,
    byLevel,
    strengths: [
      ...list.filter((u) => u.state === 'mastered').map((u) => u.unit),
      ...(['easy', 'medium', 'hard'] as const).filter((l) => byLevel[l].total >= 3 && rate(l) >= 0.8).map((l) => `الأسئلة ${LEVEL_AR[l]}`),
    ],
    weaknesses: [
      ...list.filter((u) => u.state === 'weak').map((u) => `${u.unit}${u.basics ? ' (الأساسيات)' : ''}`),
      ...(['easy', 'medium', 'hard'] as const).filter((l) => byLevel[l].total >= 3 && rate(l) < 0.5).map((l) => `الأسئلة ${LEVEL_AR[l]}`),
    ],
    // الأسئلة مرتبة بترتيب المنهج، فأول خطأ هو أقدم درس يحتاجه
    start: wrong[0] ? { bookId: wrong[0].bookId, sectionId: wrong[0].sectionId, lesson: wrong[0].lesson, book: wrong[0].book } : undefined,
  }
}

/** للخطة: حالة كل درس اختُبر فيه الطالب (المفتاح bookId:sectionId) */
export function lessonStates(results: SubjectResult[]) {
  const m = new Map<string, { ok: boolean; level: string; basics: boolean }>()
  for (const r of results) {
    const a = analyze(r)
    for (const u of a.units)
      for (const l of u.lessons) {
        const k = `${l.bookId}:${l.sectionId}`
        const prev = m.get(k)
        m.set(k, { ok: (prev?.ok ?? true) && l.ok, level: l.level, basics: u.basics })
      }
  }
  return m
}

// ===== بناء البنك (لوحة المسؤول) =====
export interface BankItem {
  id: string
  bookId: string
  sectionId: string
  book: string
  unit?: string
  lesson: string
  page: number
  printed?: string
  quote: string
  type: 'mcq' | 'tf'
  level: 'easy' | 'medium' | 'hard'
  skill?: string
  q: string
  options: string[]
  answer: string
  why: string
}
export interface BankBook {
  id: string
  title: string
  subject: string
  sections: Section[]
}
export interface BankBuild {
  subject: string
  items: BankItem[]
  /** المرشحون للمراجعة (أساسي وبديلان لكل موضع) */
  candidates: BankItem[]
  minutes: number
  coverage: { units: number; covered: number; lessons: number; readyLessons: number; totalLessons: number }
  /** لماذا لا يُنشر بعد */
  blockers: string[]
  unreviewed: number
}

/** معرّف ثابت للسؤال: من الكتاب والدرس ونص السؤال */
export function itemId(bookId: string, sectionId: string, q: string) {
  let h = 2166136261
  for (const c of `${bookId}|${sectionId}|${q}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return `${bookId.slice(2, 8)}-${sectionId}-${h.toString(36)}`
}

/** الوحدة: أقرب عنوان من المستوى الأول قبل الدرس؛ والكتاب الذي لا وحدات فيه يُقسم إلى أجزاء متتالية */
export function unitsOf(sections: Section[], lessons: Section[], bookTitle: string) {
  const m = new Map<string, string>()
  const parents = sections.filter((s) => s.level === 1)
  const hasUnits = lessons.some((l) => l.level === 2)
  lessons.forEach((l, i) => {
    if (hasUnits && l.level === 2) {
      const p = [...parents].reverse().find((s) => s.page <= l.page && sections.indexOf(s) < sections.indexOf(l))
      m.set(l.id, p?.title ?? bookTitle)
    } else if (hasUnits) m.set(l.id, l.title)
    else m.set(l.id, `${bookTitle}: الجزء ${Math.floor(i / Math.max(3, Math.ceil(lessons.length / 6))) + 1}`)
  })
  return m
}

const MATH = 'الرياضيات'
const SCIENCE = new Set(['الفيزياء', 'الكيمياء', 'العلوم الهندسية'])
const WEAK_NOTE = 'نص هذه الصفحة مقروء آلياً بدقة منخفضة لأن فيها معادلات؛ افتح الصفحة الأصلية لترى المصدر.'
const INTRO = /مقدمة|تمهيد|نبذة تاريخية|تاريخ/
/** هل في الحزمة ما يكفي لاعتبار الدرس جاهزاً (الشرط نفسه في لوحة الجاهزية) */
export function packComplete(subject: string, i?: PackInfo) {
  if (!i || i.status === 'hidden' || !i.parts.includes('checked')) return false
  return i.parts.includes(`rv${reviewVersion(subject)}`) && (subject !== MATH || i.parts.includes('verified'))
}
const errataPage = (bookId: string, page: number) => ERRATA.some((e) => e.bookId === bookId && e.page === page)

/** سؤال يصلح للبنك: يُفحص آلياً قبل المراجعة اليدوية */
export function eligible(subject: string, p: LessonPack, x: LessonPack['quiz'][number], verified = false) {
  if (x.flag || (x.type !== 'mcq' && x.type !== 'tf')) return null
  const options = (x.options ?? []).map((o) => o.trim()).filter(Boolean)
  if (options.length < 2 || new Set(options).size !== options.length || !options.includes(x.answer.trim())) return null
  // خيارات بحروف ترتيب (أ) ب)…) لا تصلح لأن الخيارات تُخلط لكل طالب
  if (options.some((o) => /^[(]?[أابجدهـa-d][).]\s/.test(o))) return null
  if (x.type === 'tf' && !(options.length === 2 && options.includes('صح') && options.includes('خطأ')) && !/^(true|false)$/i.test(x.answer)) return null
  const c = p.cites.find((y) => y.n === x.n)
  if (!c || !c.quote || errataPage(p.bookId, c.page)) return null
  // الإجابة واردة في مقطع الكتاب (أو السؤال مرتبط به في الرياضيات، وحلوله متحقق منها بحل مستقل)
  // مسائل الدروس المتحقق منها بحل مستقل (الرياضيات، ومسائل العلوم): المقطع في صفحات الدرس يكفي، والمراجعة اليدوية تعيد الحل
  const problem = subject === MATH || (SCIENCE.has(subject) && /[0-9٠-٩]/.test(x.q + x.answer))
  if (problem && verified && c.page >= p.from && c.page <= p.to && x.why.trim().length >= 8) return { options, cite: c }
  // نص الصفحة مقروء آلياً بدقة منخفضة: لا يصلح دليلاً إلا لمسألة متحقق منها بحل مستقل (أعلاه)
  if (c.weak) return null
  const grounded = subject === MATH ? overlap(x.q, c.quote) >= 0.2 : x.type === 'mcq' ? overlap(x.answer, c.quote) >= 0.5 && overlap(x.q, c.quote) >= 0.2 : overlap(x.q, c.quote) >= 0.4
  if (!grounded || x.why.trim().length < 8) return null
  return { options, cite: c }
}

const similar = (a: string, b: string) => {
  const x = new Set(tokens(a))
  const y = new Set(tokens(b))
  const inter = [...x].filter((w) => y.has(w)).length
  return inter / Math.max(1, Math.min(x.size, y.size))
}

/**
 * يختار أسئلة المادة: متوازنة بين الوحدات (بالدور، بترتيب المنهج) والمستويات (سهل، متوسط، صعب، متوسط…)،
 * سؤال واحد من الدرس ما أمكن، ولا تكرار لفكرة واحدة. المعتمد في المراجعة فقط يدخل الاختبار.
 */
export function buildBank(subject: string, books: BankBook[], info: (b: string, s: string) => PackInfo | undefined, packs: (b: string) => Record<string, LessonPack>, lessonsOf: (s: Section[]) => Section[]): BankBuild {
  const plan = PLAN_OF[subject] ?? { n: 20, minutes: 30 }
  const rev = PLACEMENT_REVIEW[subject] ?? { approved: [], rejected: {} }
  const approved = new Set(rev.approved)
  type Slot = { unit: string; lessons: { book: BankBook; s: Section; pool: BankItem[] }[] }
  const slots: Slot[] = []
  let totalLessons = 0
  let readyLessons = 0
  for (const b of books) {
    const lessons = lessonsOf(b.sections)
    const unit = unitsOf(b.sections, lessons, b.title)
    totalLessons += lessons.length
    const ps = packs(b.id)
    for (const s of lessons) {
      const p = ps[s.id]
      const ok = packComplete(subject, info(b.id, s.id)) && p
      if (ok) readyLessons++
      const pool: BankItem[] = []
      if (ok)
        for (const x of p.quiz) {
          const e = eligible(subject, p, x, !!info(b.id, s.id)?.parts.includes('verified'))
          if (!e) continue
          const id = itemId(b.id, s.id, x.q)
          if (rev.rejected[id]) continue
          pool.push({ id, bookId: b.id, sectionId: s.id, book: b.title, unit: unit.get(s.id), lesson: s.title, page: e.cite.page, ...(e.cite.printed ? { printed: e.cite.printed } : {}), quote: e.cite.weak ? WEAK_NOTE : e.cite.quote.slice(0, 850), type: x.type as 'mcq' | 'tf', level: x.level, q: x.q, options: e.options, answer: x.answer.trim(), why: x.why.trim() })
        }
      const u = unit.get(s.id) ?? b.title
      let slot = slots.find((x) => x.unit === u && x.lessons[0]?.book.id === b.id)
      if (!slot) slots.push((slot = { unit: u, lessons: [] }))
      slot.lessons.push({ book: b, s, pool })
    }
  }
  const pattern: BankItem['level'][] = ['easy', 'medium', 'hard', 'medium']
  const problemy = subject === MATH || SCIENCE.has(subject)
  // الدروس التمهيدية والتاريخية لا تقيس المستوى: تُستبعد
  for (const slot of slots) slot.lessons = slot.lessons.filter((l) => !INTRO.test(l.s.title))
  const live = slots.filter((s) => s.lessons.some((l) => l.pool.length))
  const rank = (x: BankItem, level: BankItem['level']) => (x.level === level ? 0 : 3) + (problemy && !/[0-9٠-٩]/.test(x.q + x.answer) ? 2 : 0) + (x.type === 'tf' ? 1 : 0)
  // المواضع: بالدور على الوحدات، وفي كل وحدة درس مختلف كل مرة موزع على امتداد الوحدة
  type Plan = { level: BankItem['level']; options: BankItem[] }
  const plans: Plan[] = []
  const used = new Set<string>()
  const taken: BankItem[] = []
  for (let round = 0; plans.length < plan.n && round < 12; round++) {
    let added = false
    for (const [ui, slot] of live.entries()) {
      if (plans.length >= plan.n) break
      const level = pattern[plans.length % pattern.length]
      const ls = slot.lessons.filter((l) => l.pool.length)
      const n = ls.length
      for (let k = 0; k < n; k++) {
        const l = ls[(Math.floor(((round + 0.5) * n) / 3) + k + ui) % n]
        const key = `${l.book.id}:${l.s.id}`
        if (used.has(key) && round < 2) continue
        const fresh = l.pool.filter((x) => !taken.some((c) => c.id === x.id || similar(c.q, x.q) > 0.6)).sort((a, b) => rank(a, level) - rank(b, level))
        if (!fresh.length) continue
        used.add(key)
        const options = fresh.slice(0, 3)
        taken.push(...options)
        plans.push({ level, options })
        added = true
        break
      }
    }
    if (!added) break
  }
  // المعتمد في المراجعة وحده يدخل؛ والمرشحون الذين لم يُراجَعوا بعد في المواضع التي لم يُعتمد لها سؤال
  const chosen: BankItem[] = []
  const candidates: BankItem[] = []
  for (const p of plans) {
    const ok = p.options.find((x) => approved.has(x.id))
    if (ok) chosen.push(ok)
    candidates.push(...p.options)
  }
  // ترتيب العرض: بترتيب المنهج (الكتاب ثم الدرس)، ليكون أول خطأ أقدم درس يحتاجه الطالب
  const pos = (x: BankItem) => {
    const bi = books.findIndex((b) => b.id === x.bookId)
    return bi * 10000 + (books[bi]?.sections.findIndex((s) => s.id === x.sectionId) ?? 0)
  }
  chosen.sort((a, b) => pos(a) - pos(b))
  const units = slots.filter((s) => s.lessons.length).length
  const covered = new Set(chosen.map((x) => `${x.bookId}:${x.unit}`)).size
  const blockers: string[] = []
  if (readyLessons < totalLessons * 0.9) blockers.push(`الدروس الجاهزة ${readyLessons} من ${totalLessons}: يلزم ٩٠٪ على الأقل كي يغطي الاختبار المنهج`)
  if (covered < Math.ceil(units * 0.8)) blockers.push(`الأسئلة تغطي ${covered} من ${units} وحدة: يلزم ٨٠٪ على الأقل`)
  if (chosen.length < Math.min(plan.n, 12)) blockers.push(`الأسئلة المعتمدة ${chosen.length}، والمطلوب ${plan.n}`)
  const unreviewed = plans.filter((p) => !p.options.some((x) => approved.has(x.id))).reduce((n, p) => n + p.options.filter((c) => !rev.rejected[c.id]).length, 0)
  return { subject, items: chosen, candidates, minutes: plan.minutes, coverage: { units, covered, lessons: new Set(chosen.map((x) => x.sectionId + x.bookId)).size, readyLessons, totalLessons }, blockers, unreviewed }
}

export const publishBank = (b: BankBuild, publish: boolean) =>
  api<{ ok: boolean; n: number }>(`/admin/placement/bank/${enc(b.subject)}`, {
    method: 'PUT',
    body: { publish, bank: { items: b.items, minutes: b.minutes, coverage: b.coverage, review: `روجع كل سؤال يدوياً مقابل مقطعه في الكتاب${b.subject === MATH ? '، وأعيد حل مسائل الرياضيات بصورة مستقلة' : ''}` } },
  })

// ===== لوحة المسؤول =====
export interface AdminPlacement {
  banks: { subject: string; n: number; published: boolean; updated?: number; minutes?: number; coverage?: BankBuild['coverage'] | null; review?: string }[]
  people: { id: string; subjects: string[]; journey: { subjects: string[]; started: number; completed: number | null } | null; tests: { subject: string; status: string; score: number | null; total: number | null; elapsed_ms: number; started: number; submitted: number | null }[] }[]
}
export const adminPlacement = () => api<AdminPlacement>('/admin/placement')
export const adminPlacementResults = (id: string) => api<{ results: SubjectResult[] }>(`/admin/placement/results/${enc(id)}`)
export const adminPlacementReset = (userId: string, subject?: string) => api<{ ok: boolean; archived: number }>('/admin/placement/reset', { method: 'POST', body: { userId, confirm: `إعادة ${userId}`, ...(subject ? { subject } : {}) } })

// ===== حالة الرحلة على هذا الجهاز (للخطة والرئيسية) =====
import { useSyncExternalStore as useSES } from 'react'
import { load as loadLocal, save as saveLocal } from '../storage/local'
import { currentUser } from '../server/account'

type Cached = { at: number; o: PlacementOverview }
let cached: Cached | null = null
let cachedFor = ''
const psubs = new Set<() => void>()
const keyOf = () => `placement:${currentUser()?.id ?? ''}`
function current(): Cached | null {
  const k = keyOf()
  if (k !== cachedFor) {
    cachedFor = k
    cached = loadLocal<Cached>(k)
  }
  return cached
}
export async function refreshPlacement(): Promise<PlacementOverview | null> {
  if (currentUser()?.role !== 'student') return null
  try {
    const o = await placementOverview()
    cached = { at: Date.now(), o }
    cachedFor = keyOf()
    saveLocal(cachedFor, cached)
    psubs.forEach((l) => l())
    return o
  } catch {
    return current()?.o ?? null
  }
}
export const usePlacement = () => useSES((l) => (psubs.add(l), () => void psubs.delete(l)), () => current()?.o ?? null)
/** لم يكمل الطالب رحلته بعد وفيها ما لم يُسلَّم */
export const needsPlacement = (o: PlacementOverview | null) => !!o?.journey && !o.journey.completed
/** حفظ الإجابات بلا اتصال: تُرسل عند عودة الاتصال */
export const offlineKey = (subject: string) => `placement-draft:${currentUser()?.id ?? ''}:${subject}`
