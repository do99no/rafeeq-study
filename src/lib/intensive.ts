/**
 * الخطة المكثفة: إنهاء المنهج قبل الموعد المستهدف (28 يناير 2027)، ثم الاستعداد للامتحانات (فبراير ومارس، حتى بداية أبريل).
 * دالة نقية تُحسب من بيانات الطالب الفعلية؛ لا أرقام افتراضية.
 *
 * الوقت:
 * - النوم ٨ ساعات ثابتة لا تُقلَّص، والوجبات ساعة، فالمتاح ١٥ ساعة.
 * - الدراسة جلسات ٥٠ دقيقة بفواصل ١٠ دقائق، فأقصى دراسة فعلية ١٢٫٥ ساعة يومياً.
 *
 * حجم الدرس (دقائق):
 * - الصفحات × (١٨ للرياضيات والعلوم، ١٢ لغيرها) للشرح والفهم.
 * - + الصفحات × (١٠ للرياضيات والعلوم، ٤ لغيرها) للتدريبات والمسائل.
 * - + ١٠ دقائق لاختبار قصير.
 * - بين ٣٠ و١٨٠ دقيقة.
 *
 * المتبقي من الدرس:
 * - المكتمل: صفر.
 * - المبدوء: الجزء غير المنجز.
 * - ما أتقنه في تحديد المستوى (سؤال متوسط أو صعب): ٤٠٪ للمراجعة.
 *
 * إعادة الجدولة: من المتبقي فعلاً والأيام المتبقية، كل يوم، لا بنقل المهام إلى الغد.
 * التأخر: مقارنة بخط أساس يُحفظ يوم بدء الخطة.
 */
export const SLEEP_H = 8
export const MEALS_H = 1
export const SESSION_MIN = 50
export const BREAK_MIN = 10
/** أقصى دراسة فعلية في اليوم بعد النوم والوجبات والفواصل */
export const MAX_STUDY_MIN = Math.floor(((24 - SLEEP_H - MEALS_H) * 60 * SESSION_MIN) / (SESSION_MIN + BREAK_MIN))
const DAY = 86400_000
const SCIENCE = /رياضيات|فيزياء|كيمياء|هندسية|أحياء/

export interface ILesson {
  subject: string
  bookId: string
  sectionId: string
  title: string
  page: number
  endPage: number
  unit?: string
  state: 'done' | 'started' | 'none'
  /** ما احتُسب من تغطية الدرس (٠–١) */
  credit: number
  /** أتقنه في تحديد المستوى */
  known?: boolean
  /** فيه محتوى جاهز */
  ready: boolean
  lastAt?: number
}
export interface Session {
  kind: 'lesson' | 'review' | 'quiz' | 'exam-review' | 'past-exam' | 'simulation' | 'remedial' | 'terms'
  subject: string
  title: string
  minutes: number
  steps: string[]
  bookId?: string
  sectionId?: string
  from?: number
  to?: number
  ready?: boolean
  /** جزء من درس مقسوم على أكثر من جلسة */
  part?: { k: number; n: number }
  /** مفتاح ثابت لمتابعة الإنجاز */
  key: string
}
export interface IDay {
  date: string
  sessions: Session[]
  minutes: number
}
export interface SubjectPlan {
  subject: string
  lessons: number
  done: number
  remainingLessons: number
  totalMin: number
  remainingMin: number
  /** تاريخ إنهاء المادة المتوقع بهذه الخطة */
  finish?: string
  behind: boolean
  notReady: number
}
export interface IntensivePlan {
  phase: 'learn' | 'exam' | 'finished'
  today: string
  start: string
  finish: string
  exam: string
  daysLeft: number
  totalMin: number
  remainingMin: number
  doneFraction: number
  /** الدقائق اللازمة يومياً لإنهاء المنهج في الموعد */
  requiredPerDay: number
  /** المعتمد في الخطة (لا يتجاوز المتاح) */
  perDay: number
  feasible: boolean
  /** تاريخ الإنهاء المتوقع إن استمر الطالب على المعتمد */
  projectedFinish: string
  expectedDoneMin?: number
  behindMin: number
  /** ساعات إضافية يومياً لاستدراك التأخر حتى الموعد */
  extraPerDay: number
  subjects: SubjectPlan[]
  days: IDay[]
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const at = (d: string) => Date.parse(`${d}T00:00:00Z`)
export function lessonMinutes(subject: string, pages: number) {
  const sci = SCIENCE.test(subject)
  return Math.max(30, Math.min(180, Math.round(pages * (sci ? 18 : 12) + pages * (sci ? 10 : 4) + 10)))
}
export function remainingOf(l: ILesson) {
  const full = lessonMinutes(l.subject, l.endPage - l.page + 1)
  if (l.state === 'done') return 0
  if (l.known) return Math.round(full * 0.4)
  return Math.round(full * (1 - Math.min(0.9, l.credit)))
}
const stepsFor = (l: ILesson, part?: { k: number; n: number }) => {
  const sci = SCIENCE.test(l.subject)
  const all = l.known
    ? ['مراجعة سريعة لما أتقنته في تحديد المستوى', 'سؤالا فهم للتأكد', 'اختبار قصير']
    : ['الشرح خطوة بخطوة مع رفيق', 'الإجابة عن أسئلة الفهم', sci ? 'حل التدريبات والمسائل' : 'التدريب وأسئلة الدرس', 'اختبار قصير للدرس']
  if (!part || part.n === 1) return all
  // الجزء الأول: الشرح والفهم، والأخير: التطبيق والاختبار
  const a = Math.floor(((part.k - 1) * all.length) / part.n)
  const b = Math.max(a + 1, Math.floor((part.k * all.length) / part.n))
  const slice = all.slice(Math.min(a, all.length - 1), b)
  return slice.length ? slice : [`متابعة: ${all[all.length - 1]}`]
}

export function buildIntensive(input: { lessons: ILesson[]; now?: number; start: string; finish: string; exam: string; baselineMin?: number; weakSubjects?: Set<string>; pastExams?: Set<string> }): IntensivePlan {
  const now = input.now ?? Date.now()
  const today = iso(now)
  const lessons = input.lessons
  const subjects = [...new Set(lessons.map((l) => l.subject))]
  const totalMin = lessons.reduce((n, l) => n + lessonMinutes(l.subject, l.endPage - l.page + 1), 0)
  const remainingMin = lessons.reduce((n, l) => n + remainingOf(l), 0)
  const daysLeft = Math.max(0, Math.round((at(input.finish) - at(today)) / DAY) + 1)
  const requiredPerDay = daysLeft ? Math.ceil(remainingMin / daysLeft) : remainingMin
  const perDay = Math.min(MAX_STUDY_MIN, Math.max(requiredPerDay, 60))
  const feasible = requiredPerDay <= MAX_STUDY_MIN
  const projectedDays = Math.ceil(remainingMin / perDay)
  const projectedFinish = iso(at(today) + Math.max(0, projectedDays - 1) * DAY)
  // التأخر عن خط الأساس: ما يُفترض إنجازه حتى اليوم بالتوزيع المتساوي من يوم البدء
  let expectedDoneMin: number | undefined
  let behindMin = 0
  if (input.baselineMin && at(today) > at(input.start)) {
    const span = Math.max(1, (at(input.finish) - at(input.start)) / DAY + 1)
    const elapsed = Math.min(span, (at(today) - at(input.start)) / DAY)
    expectedDoneMin = Math.round((input.baselineMin * elapsed) / span)
    const doneSinceStart = input.baselineMin - remainingMin
    behindMin = Math.max(0, expectedDoneMin - doneSinceStart)
  }
  const extraPerDay = daysLeft ? Math.max(0, requiredPerDay - (input.baselineMin ? Math.ceil(input.baselineMin / Math.max(1, (at(input.finish) - at(input.start)) / DAY + 1)) : requiredPerDay)) : 0

  const phase: IntensivePlan['phase'] = remainingMin === 0 || at(today) > at(input.finish) ? (at(today) >= at(input.exam) ? 'finished' : 'exam') : 'learn'
  const days: IDay[] = []
  const queues = new Map(subjects.map((s) => [s, lessons.filter((l) => l.subject === s && remainingOf(l) > 0)]))
  const subjRemaining = new Map(subjects.map((s) => [s, (queues.get(s) ?? []).reduce((n, l) => n + remainingOf(l), 0)]))
  const finishOf = new Map<string, string>()

  if (phase === 'learn') {
    // توزيع متوازن: كل يوم تأخذ كل مادة حصة من الوقت بنسبة ما بقي منها، فتنتهي المواد معاً تقريباً
    const reviewMin = 20
    const pending = new Map<string, { l: ILesson; left: number; parts: number; k: number }[]>()
    for (const [s, q] of queues) pending.set(s, q.map((l) => { const m = remainingOf(l); return { l, left: m, parts: Math.max(1, Math.ceil(m / SESSION_MIN)), k: 0 } }))
    for (let d = 0; [...pending.values()].some((q) => q.length) && d < 400; d++) {
      const date = iso(at(today) + d * DAY)
      const day: IDay = { date, sessions: [], minutes: 0 }
      // مراجعة قصيرة يومية لما سبق دراسته (بعد اليوم الأول)، كي لا يُنسى أثناء التقدم
      if (d > 0 || lessons.some((l) => l.state === 'done')) {
        day.sessions.push({ kind: 'review', subject: 'كل المواد', title: 'مراجعة قصيرة لما درسته أمس والبطاقات المستحقة', minutes: reviewMin, steps: ['البطاقات المستحقة', 'أسئلة سريعة على دروس الأمس'], key: `rev-${date}` })
        day.minutes += reviewMin
      }
      const totalLeft = [...pending.values()].reduce((n, q) => n + q.reduce((m, x) => m + x.left, 0), 0)
      const budget = perDay - day.minutes
      for (const s of subjects) {
        const q = pending.get(s)!
        if (!q.length) continue
        const left = q.reduce((m, x) => m + x.left, 0)
        let share = Math.max(SESSION_MIN, Math.round((budget * left) / Math.max(1, totalLeft)))
        let used = 0
        while (q.length && used < share) {
          const cur = q[0]
          const m = Math.min(SESSION_MIN, cur.left, Math.max(15, share - used))
          cur.k++
          const part = cur.parts > 1 ? { k: Math.min(cur.k, cur.parts), n: cur.parts } : undefined
          day.sessions.push({
            kind: 'lesson', subject: s, title: cur.l.title + (part ? ` (الجزء ${part.k} من ${part.n})` : ''), minutes: m, steps: stepsFor(cur.l, part),
            bookId: cur.l.bookId, sectionId: cur.l.sectionId, from: cur.l.page, to: cur.l.endPage, ready: cur.l.ready, ...(part ? { part } : {}), key: `${cur.l.bookId}:${cur.l.sectionId}:${cur.k}`,
          })
          day.minutes += m
          used += m
          cur.left -= m
          if (cur.left <= 0) {
            q.shift()
            // اختبار قصير عند نهاية الوحدة
            if (cur.l.unit && q[0]?.l.unit !== cur.l.unit) {
              day.sessions.push({ kind: 'quiz', subject: s, title: `اختبار الوحدة: ${cur.l.unit}`, minutes: 20, steps: ['اختبار وحدة من التقييمات', 'مراجعة الأخطاء'], bookId: cur.l.bookId, key: `unit-${cur.l.bookId}-${cur.l.unit}` })
              day.minutes += 20
              used += 20
            }
          }
          if (used >= share) break
          share = Math.min(share, budget)
        }
        if (!q.length && !finishOf.has(s)) finishOf.set(s, date)
      }
      days.push(day)
    }
  } else if (phase === 'exam') {
    // الاستعداد للامتحانات: مادة رئيسية كل يوم بالدور، مع علاج ومراجعة قوانين يومية
    const start = Math.max(at(today), at(input.finish) + DAY)
    for (let d = 0; start + d * DAY < at(input.exam); d++) {
      const date = iso(start + d * DAY)
      const s = subjects[d % Math.max(1, subjects.length)]
      const weak = input.weakSubjects?.has(s)
      const sessions: Session[] = [
        { kind: 'exam-review', subject: s, title: `مراجعة شاملة: ${s}`, minutes: 150, steps: ['ملخصات الوحدات ومراجعتها قبل الامتحان', 'خريطة الوحدة'], key: `er-${date}` },
        input.pastExams?.has(s)
          ? { kind: 'past-exam', subject: s, title: `امتحان شهادة سابق (أصلي): ${s}`, minutes: 180, steps: ['حل الامتحان بزمنه', 'مقارنة بنموذج الإجابة الرسمي إن وُجد'], key: `pe-${date}` }
          : { kind: 'simulation', subject: s, title: `محاكاة امتحان بزمن (تدريب من رفيق، ليس امتحاناً رسمياً): ${s}`, minutes: 120, steps: ['محاكاة من التقييمات', 'تحليل الأخطاء'], key: `sim-${date}` },
        { kind: 'remedial', subject: s, title: weak ? `علاج نقاط الضعف: ${s}` : `مراجعة أخطائي السابقة: ${s}`, minutes: 60, steps: ['اختبار علاجي', 'إعادة شرح ما أخطأت فيه'], key: `rm-${date}` },
        { kind: 'terms', subject: 'كل المواد', title: 'القوانين والتعريفات والمصطلحات (بطاقات)', minutes: 40, steps: ['البطاقات المستحقة', 'المطابقة'], key: `tr-${date}` },
      ]
      days.push({ date, sessions, minutes: sessions.reduce((n, x) => n + x.minutes, 0) })
    }
  }

  const subjectPlans: SubjectPlan[] = subjects.map((s) => {
    const ls = lessons.filter((l) => l.subject === s)
    const total = ls.reduce((n, l) => n + lessonMinutes(s, l.endPage - l.page + 1), 0)
    const rem = subjRemaining.get(s) ?? 0
    const doneN = ls.filter((l) => l.state === 'done').length
    // متأخرة إن كانت تنتهي بعد الموعد، أو بقي منها أكثر من نصيبها من الوقت المتبقي
    const fin = rem ? finishOf.get(s) : today
    return { subject: s, lessons: ls.length, done: doneN, remainingLessons: ls.length - doneN, totalMin: total, remainingMin: rem, finish: fin, behind: !!fin && at(fin) > at(input.finish), notReady: ls.filter((l) => !l.ready && l.state !== 'done').length }
  })
  return { phase, today, start: input.start, finish: input.finish, exam: input.exam, daysLeft, totalMin, remainingMin, doneFraction: totalMin ? 1 - remainingMin / totalMin : 0, requiredPerDay, perDay, feasible, projectedFinish, expectedDoneMin, behindMin, extraPerDay, subjects: subjectPlans, days }
}
