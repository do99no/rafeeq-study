import type { Section } from '../services/books/types'
import type { Book, Mistake, Studied } from '../types'
import { removedFromExam } from '../data/syllabus'

/**
 * خطة الدراسة: تُحسب من الدروس المتبقية فعلاً وموعد الامتحان، فتتجدد كل يوم من تقدم الطالب
 * (المتأخر يُعاد توزيعه تلقائياً). لا تخمين لموعد رسمي: الموعد من خطة المسؤول أو يحدده الطالب.
 */
export interface PlanItem {
  kind: 'learn' | 'review' | 'final'
  bookId: string
  subject: string
  title: string
  from: number
  to: number
  sectionId?: string
  minutes: number
  offExam?: boolean
}
export interface PlanDay {
  date: string
  items: PlanItem[]
  minutes: number
}
export interface StudyPlan {
  days: PlanDay[]
  remaining: number
  done: number
  total: number
  /** أيام التعلم قبل المراجعة النهائية */
  learnDays: number
  finalFrom?: string
  behind: boolean
  perDay: number
}

const DAY = 86400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const lessonsOfSections = (sections: Section[]) => sections.filter((s, i) => s.level === 2 || !(sections[i + 1]?.level === 2))
/** تقدير واقعي: نحو ٢٠ دقيقة للصفحة في الرياضيات والعلوم، و١٥ لغيرها، بين ٢٠ و٩٠ دقيقة للدرس */
const minutesOf = (subject: string, pages: number) => Math.min(90, Math.max(20, Math.round(pages * (/رياضيات|فيزياء|كيمياء|هندسية|أحياء/.test(subject) ? 20 : 15))))

export function buildPlan(input: {
  books: Book[]
  sections: Record<string, Section[]>
  studied: Record<string, Studied>
  mistakes: Mistake[]
  examDate: string
  dailyMin: number
  today?: number
}): StudyPlan {
  const today = input.today ?? Date.now()
  const exam = new Date(`${input.examDate}T00:00:00`).getTime()
  const daysLeft = Math.max(1, Math.floor((exam - today) / DAY))
  const finalDays = daysLeft > 30 ? 14 : Math.max(1, Math.floor(daysLeft / 4))
  const learnDays = Math.max(1, daysLeft - finalDays)
  const isDone = (bookId: string, s: Section) => Object.values(input.studied).some((x) => x.bookId === bookId && x.from === s.page && x.to === s.endPage && (x.explained || (x.taught && x.taught.k >= x.taught.n) || (x.checks && x.checks.total >= 2)))

  // الدروس المتبقية لكل مادة بترتيب الكتاب؛ المحذوف من الامتحان في آخرها
  const queues = new Map<string, PlanItem[]>()
  let total = 0
  let done = 0
  for (const b of input.books) {
    const subject = b.subject ?? b.title
    for (const s of lessonsOfSections(input.sections[b.id] ?? [])) {
      total++
      if (isDone(b.id, s)) {
        done++
        continue
      }
      const item: PlanItem = { kind: 'learn', bookId: b.id, subject, title: s.title, from: s.page, to: s.endPage, sectionId: s.id, minutes: minutesOf(subject, s.endPage - s.page + 1), ...(removedFromExam(b.id, s.title) ? { offExam: true } : {}) }
      queues.set(subject, [...(queues.get(subject) ?? []), item])
    }
  }
  for (const [k, q] of queues) queues.set(k, [...q.filter((x) => !x.offExam), ...q.filter((x) => x.offExam)])

  // تبادل المواد يوماً بيوم (درس من كل مادة بالدور)، بحد الدقائق اليومية
  const order: PlanItem[] = []
  const lists = [...queues.values()]
  for (let i = 0; lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) order.push(l[i])
  const remainingMin = order.reduce((s, x) => s + x.minutes, 0)
  const perDay = Math.max(input.dailyMin, Math.ceil(remainingMin / learnDays))
  const days: PlanDay[] = []
  let d = 0
  let cur: PlanDay = { date: iso(today), items: [], minutes: 0 }
  // مراجعة أخطاء سابقة غير محلولة: أول الخطة
  const weak = [...new Map(input.mistakes.filter((m) => !m.resolved).map((m) => [m.topic, m])).values()].slice(0, 6)
  for (const m of weak) {
    const b = input.books.find((x) => x.id === m.bookId)
    cur.items.push({ kind: 'review', bookId: m.bookId, subject: b?.subject ?? '', title: `مراجعة: ${m.topic}`, from: m.page, to: m.page, minutes: 15 })
    cur.minutes += 15
  }
  for (const it of order) {
    if (cur.minutes + it.minutes > perDay && cur.items.length) {
      days.push(cur)
      d++
      cur = { date: iso(today + d * DAY), items: [], minutes: 0 }
    }
    cur.items.push(it)
    cur.minutes += it.minutes
  }
  if (cur.items.length) days.push(cur)
  // المراجعة النهائية: مادة في كل يوم بالدور
  const subjects = [...queues.keys(), ...new Set(input.books.map((b) => b.subject ?? b.title))].filter((v, i, a) => a.indexOf(v) === i)
  const finalStart = Math.max(days.length, learnDays)
  for (let i = 0; i < finalDays && subjects.length; i++) {
    const subject = subjects[i % subjects.length]
    const book = input.books.find((b) => (b.subject ?? b.title) === subject)!
    days.push({ date: iso(today + (finalStart + i) * DAY), minutes: input.dailyMin, items: [{ kind: 'final', bookId: book.id, subject, title: `مراجعة نهائية: ${subject} (ملخصات ليلة الامتحان، واختبار صعب، والأخطاء السابقة)`, from: 1, to: 1, minutes: input.dailyMin }] })
  }
  return { days, remaining: order.length, done, total, learnDays, finalFrom: subjects.length ? iso(today + finalStart * DAY) : undefined, behind: days.filter((x) => x.items.some((i) => i.kind === 'learn')).length > learnDays, perDay }
}
