/**
 * تقدم الطالب في كل مادة: رقمان منفصلان لا يُخلطان، وكلاهما من بيانات الطالب الفعلية فقط.
 *
 * ١) التغطية (٠–١٠٠): كم درس من المنهج.
 *    - الدرس المكتمل = ١:
 *      - أنهى الشرح خطوة بخطوة إلى آخره؛
 *      - أو شُرح كاملاً وأجاب عن سؤالي فهم فأكثر بنسبة ٦٠٪ فأكثر؛
 *      - أو أجاب عن ٣ أسئلة فهم فأكثر بنسبة ٧٠٪ فأكثر؛
 *      - أو نجح في اختبار الدرس الجاهز بنسبة ٧٠٪ فأكثر.
 *    - الدرس المبدوء غير المكتمل: ٠٫٦ × نسبة ما أنهاه من خطوات الشرح، أو ٠٫٣ إن شُرح أو اختُبر دون إكمال.
 *    - فتح الدرس وحده لا يُحتسب (لا يُنشأ له سجل دراسة).
 *    - التغطية = مجموع الدروس ÷ عدد دروس المادة × ١٠٠.
 *
 * ٢) الإتقان (٠–١٠٠، أو «بيانات غير كافية»): صحة الإجابات الفعلية.
 *    - المصادر: أسئلة الفهم، وأسئلة الاختبارات منسوبة إلى درسها بصفحة مصدرها، وأسئلة تحديد المستوى.
 *    - إتقان الدرس = الصحيح ÷ المجاب.
 *    - الدرس الذي فيه أخطاء لم يراجعها الطالب بعد: لا يزيد إتقانه على ٧٠ حتى تُراجع.
 *    - إتقان المادة = متوسط إتقان دروسها مرجَّحاً بعدد الأسئلة، ولا يُعرض إلا بعد ٥ إجابات على الأقل في المادة.
 *
 * إجابات تحديد المستوى تدخل في الإتقان فقط، لا في التغطية: الاختبار ليس دراسة للدرس.
 * لا أرقام تقديرية ولا افتراضية: ما لا بيانات له يظهر «لم يبدأ بعد» أو «بيانات غير كافية».
 */
export interface PLesson {
  bookId: string
  sectionId: string
  title: string
  page: number
  endPage: number
  /** عنوان الوحدة إن وُجد */
  unit?: string
}
export interface PStudied {
  bookId: string
  from: number
  to: number
  title: string
  at: number
  explained?: number
  taught?: { k: number; n: number }
  checks?: { right: number; total: number }
}
export interface PQuizQuestion {
  cite?: { bookId: string; page: number }
}
export interface PInput {
  subjects: { subject: string; books: { id: string; title: string; lessons: PLesson[] }[] }[]
  studied: Record<string, PStudied>
  attempts: { outputId: string; score: number; total: number; at: number; results?: boolean[] }[]
  outputs: { id: string; data: { kind: string; questions?: PQuizQuestion[] } }[]
  mistakes: { bookId: string; page: number; resolved?: boolean; at: number; topic: string }[]
  /** نتائج تحديد المستوى بعد ظهورها */
  placement?: { items: { bookId: string; sectionId: string; ok: boolean }[] }[]
  /** دروس فيها محتوى جاهز (bookId:sectionId)، لاقتراح الخطوة التالية */
  ready?: Set<string>
}
export type LessonState = 'done' | 'started' | 'none'
export interface LessonProgress extends PLesson {
  state: LessonState
  credit: number
  answered: number
  correct: number
  mastery: number | null
  openMistakes: number
  lastAt?: number
  /** درسه فعلاً (سجل دراسة أو اختبار)؛ إجابات تحديد المستوى وحدها لا تجعله مبدوءاً */
  studiedHere?: boolean
}
export interface SubjectProgress {
  subject: string
  total: number
  done: number
  started: number
  notStarted: number
  coverage: number
  mastery: number | null
  masteryLabel: string
  answered: number
  lastAt?: number
  openMistakes: number
  next?: { bookId: string; sectionId: string; title: string; from: number; to: number; why: string }
  lessons: LessonProgress[]
}

const MIN_ANSWERS = 5
const key = (b: string, s: string) => `${b}:${s}`
export const masteryLabel = (m: number | null, answered: number) =>
  m === null ? (answered ? 'بيانات غير كافية' : 'لم يُختبر بعد') : m >= 80 ? 'متقن' : m >= 60 ? 'جيد' : m >= 40 ? 'يحتاج إلى تدريب' : 'يحتاج إلى علاج'

export function computeProgress(input: PInput): SubjectProgress[] {
  const outputs = new Map(input.outputs.map((o) => [o.id, o]))
  const studied = Object.values(input.studied)
  return input.subjects.map(({ subject, books }) => {
    const lessons: LessonProgress[] = []
    for (const b of books)
      for (const l of b.lessons) {
        const s = studied.filter((x) => x.bookId === b.id && x.from === l.page && x.to === l.endPage)
        const lp: LessonProgress = { ...l, state: 'none', credit: 0, answered: 0, correct: 0, mastery: null, openMistakes: 0 }
        for (const x of s) {
          lp.lastAt = Math.max(lp.lastAt ?? 0, x.at)
          if (x.checks) {
            lp.answered += x.checks.total
            lp.correct += x.checks.right
          }
        }
        lessons.push(lp)
      }
    const byBookPage = (bookId: string, page: number) => lessons.find((l) => l.bookId === bookId && page >= l.page && page <= l.endPage)
    const byId = new Map(lessons.map((l) => [key(l.bookId, l.sectionId), l]))
    // نتائج الاختبارات: كل سؤال إلى درس صفحة مصدره؛ اختبار الدرس الجاهز إلى درسه
    const packPass = new Set<string>()
    for (const a of input.attempts) {
      const o = outputs.get(a.outputId)
      const pk = a.outputId.match(/^pk-(.+?)-(.+)-quiz-(easy|medium|hard)$/)
      const target = pk ? byId.get(key(pk[1], pk[2])) : undefined
      if (target && a.total && a.score / a.total >= 0.7) packPass.add(key(target.bookId, target.sectionId))
      const qs = o?.data.kind === 'quiz' ? (o.data.questions ?? []) : []
      if (a.results && qs.length === a.results.length) {
        a.results.forEach((ok, i) => {
          const c = qs[i]?.cite
          const l = target ?? (c ? byBookPage(c.bookId, c.page) : undefined)
          if (!l) return
          l.answered++
          if (ok) l.correct++
          l.studiedHere = true
          l.lastAt = Math.max(l.lastAt ?? 0, a.at)
        })
      } else if (target) {
        target.answered += a.total
        target.correct += a.score
        target.studiedHere = true
        target.lastAt = Math.max(target.lastAt ?? 0, a.at)
      }
    }
    for (const r of input.placement ?? [])
      for (const it of r.items) {
        const l = byId.get(key(it.bookId, it.sectionId))
        if (!l) continue
        l.answered++
        if (it.ok) l.correct++
      }
    for (const m of input.mistakes) {
      if (m.resolved) continue
      const l = byBookPage(m.bookId, m.page)
      if (l) l.openMistakes++
    }
    // حالة كل درس وتغطيته
    for (const l of lessons) {
      const s = studied.filter((x) => x.bookId === l.bookId && x.from === l.page && x.to === l.endPage)
      const taught = s.find((x) => x.taught)?.taught
      const checks = s.reduce((t, x) => ({ right: t.right + (x.checks?.right ?? 0), total: t.total + (x.checks?.total ?? 0) }), { right: 0, total: 0 })
      const explained = s.some((x) => x.explained)
      const done =
        (!!taught && taught.k >= taught.n) ||
        (explained && checks.total >= 2 && checks.right / checks.total >= 0.6) ||
        (checks.total >= 3 && checks.right / checks.total >= 0.7) ||
        packPass.has(key(l.bookId, l.sectionId))
      if (done) {
        l.state = 'done'
        l.credit = 1
      } else if (s.length || l.studiedHere) {
        l.state = 'started'
        l.credit = taught ? Math.min(0.6, (0.6 * taught.k) / Math.max(1, taught.n)) : 0.3
      }
      if (l.answered) {
        const m = Math.round((l.correct / l.answered) * 100)
        l.mastery = l.openMistakes ? Math.min(70, m) : m
      }
    }
    const total = lessons.length
    const done = lessons.filter((l) => l.state === 'done').length
    const started = lessons.filter((l) => l.state === 'started').length
    const answered = lessons.reduce((n, l) => n + l.answered, 0)
    const weighted = lessons.filter((l) => l.mastery !== null)
    const mastery = answered >= MIN_ANSWERS && weighted.length ? Math.round(weighted.reduce((n, l) => n + (l.mastery ?? 0) * l.answered, 0) / weighted.reduce((n, l) => n + l.answered, 0)) : null
    const lastAt = Math.max(0, ...lessons.map((l) => l.lastAt ?? 0)) || undefined
    const openMistakes = lessons.reduce((n, l) => n + l.openMistakes, 0)
    // الخطوة التالية: علاج ما فيه أخطاء، ثم إكمال ما بدأه، ثم أول درس لم يبدأه (فيه محتوى جاهز إن أمكن)
    const pick = (l: LessonProgress, why: string) => ({ bookId: l.bookId, sectionId: l.sectionId, title: l.title, from: l.page, to: l.endPage, why })
    const weak = lessons.filter((l) => l.openMistakes > 0).sort((a, b) => b.openMistakes - a.openMistakes)[0]
    const resume = lessons.filter((l) => l.state === 'started').sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
    const fresh = lessons.find((l) => l.state === 'none' && (!input.ready || input.ready.has(key(l.bookId, l.sectionId)))) ?? lessons.find((l) => l.state === 'none')
    const next = weak ? pick(weak, 'فيه أخطاء تحتاج إلى مراجعة') : resume ? pick(resume, 'بدأته ولم تكمله') : fresh ? pick(fresh, done ? 'الدرس التالي في المنهج' : 'أول درس في المادة') : undefined
    return {
      subject, total, done, started, notStarted: total - done - started,
      coverage: total ? Math.round((lessons.reduce((n, l) => n + l.credit, 0) / total) * 100) : 0,
      mastery, masteryLabel: masteryLabel(mastery, answered), answered, lastAt, openMistakes, next, lessons,
    }
  })
}

// ===== التنبيهات: هادئة ومشجعة، بلا لوم ولا مقارنة =====
export interface Nudge {
  kind: 'neglected' | 'not-started' | 'resume' | 'weak' | 'review' | 'behind' | 'irregular' | 'praise'
  subject?: string
  text: string
  action?: SubjectProgress['next']
  priority: number
}
const DAY = 86400_000
export function nudges(progress: SubjectProgress[], o: { now?: number; dueCards?: number; behind?: boolean; ready?: Set<string>; num?: (n: number) => string } = {}): Nudge[] {
  const now = o.now ?? Date.now()
  const N = o.num ?? String
  const out: Nudge[] = []
  const anyStudy = progress.some((p) => p.lastAt)
  const lastAny = Math.max(0, ...progress.map((p) => p.lastAt ?? 0))
  // المادة التي لا محتوى جاهز فيها لا تُعد مهملة
  const hasReady = (p: SubjectProgress) => !o.ready || p.lessons.some((l) => o.ready!.has(`${l.bookId}:${l.sectionId}`))
  for (const p of progress) {
    if (!p.total || !hasReady(p)) continue
    const days = p.lastAt ? Math.floor((now - p.lastAt) / DAY) : null
    if (p.openMistakes >= 2 && p.next)
      out.push({ kind: 'weak', subject: p.subject, priority: 90, action: p.next, text: `في ${p.subject} نقاط تحتاج إلى مراجعة قصيرة. لنراجع «${p.next.title}» معاً، ثم نكمل.` })
    else if (days !== null && days >= 4 && p.coverage < 100)
      out.push({ kind: 'neglected', subject: p.subject, priority: 80 + Math.min(days, 15), action: p.next, text: `لم تدرس ${p.subject} منذ ${N(days)} ${days > 10 ? 'يوماً' : 'أيام'}. لنبدأ بمراجعة قصيرة ثم نكمل «${p.next?.title ?? 'الدرس التالي'}».` })
    else if (days === null && anyStudy && p.next)
      out.push({ kind: 'not-started', subject: p.subject, priority: 60, action: p.next, text: `لم تبدأ ${p.subject} بعد. ابدأ بـ«${p.next.title}»، فهو قصير ومناسب للبداية.` })
    else if (p.mastery !== null && p.mastery < 50 && p.next)
      out.push({ kind: 'weak', subject: p.subject, priority: 70, action: p.next, text: `${p.subject} تحتاج إلى تدريب أكثر. خصّص اليوم جلسة قصيرة لـ«${p.next.title}».` })
    else if (p.started > 0 && p.next && p.next.why === 'بدأته ولم تكمله')
      out.push({ kind: 'resume', subject: p.subject, priority: 50, action: p.next, text: `بدأت «${p.next.title}» في ${p.subject} ولم تكمله. أكمله الآن من حيث توقفت.` })
    if (p.mastery !== null && p.mastery >= 80 && p.answered >= 10)
      out.push({ kind: 'praise', subject: p.subject, priority: 20, text: `أحسنت في ${p.subject}! حافظ على مستواك بمراجعة سريعة.` })
  }
  if (o.behind) out.push({ kind: 'behind', priority: 75, text: 'أنت متأخر قليلاً عن خطتك. وزّع رفيق الدروس المتبقية من جديد على الأيام القادمة، فابدأ بخطة اليوم.' })
  if (o.dueCards) out.push({ kind: 'review', priority: 65, text: `لديك ${N(o.dueCards)} بطاقة مستحقة للمراجعة اليوم. خمس دقائق تكفي.` })
  if (anyStudy && now - lastAny >= 3 * DAY) out.push({ kind: 'irregular', priority: 85, text: 'مرت أيام دون دراسة. جلسة قصيرة اليوم تعيدك إلى الإيقاع.' })
  return out.sort((a, b) => b.priority - a.priority)
}
