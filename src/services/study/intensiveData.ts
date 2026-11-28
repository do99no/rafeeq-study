import { useEffect, useMemo } from 'react'
import { buildIntensive, type ILesson, type IntensivePlan, type Session } from '../../lib/intensive'
import { useDocs } from '../books/process'
import { useCurriculum } from '../books/curriculum'
import { currentUser } from '../server/account'
import { actions, getState, useData } from '../../store/store'
import { EXTERNAL_PAPERS } from './exams'
import { lessonStates, usePlacement } from './placement'
import { useSubjectProgress } from './progressData'

/** الموعد المستهدف لإنهاء المنهج، وموعد الامتحانات (بداية أبريل 2027) */
export const TARGET = { finish: '2027-01-28', exam: '2027-04-01' }
const PAST = new Set(EXTERNAL_PAPERS.filter((p) => p.kind === 'past').map((p) => p.subject))
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * الخطة المكثفة للطالب الحالي، من تقدمه الفعلي في مواده المسموح بها فقط.
 * - تُحفظ بدايتها الفعلية وخط الأساس في بياناته (تتزامن مع الخادم) عند أول حساب بعد فهرسة كل كتبه.
 * - مهام اليوم تُثبَّت مرة في اليوم، فلا تتغير كلما فُتحت الصفحة.
 */
export function useIntensive(): { plan: IntensivePlan | null; preparing: boolean; todaySessions: Session[]; checked: string[]; doneKeys: Set<string> } {
  const data = useData()
  const docs = useDocs()
  const setup = useCurriculum()
  const placement = usePlacement()
  const { progress, ready } = useSubjectProgress()
  const saved = data.settings.intensive
  const student = currentUser()?.role === 'student'

  const plan = useMemo(() => {
    if (!progress.length) return null
    const known = placement?.results.length ? lessonStates(placement.results) : undefined
    const unitOf = new Map<string, string>()
    for (const p of progress)
      for (const b of new Set(p.lessons.map((l) => l.bookId))) {
        let unit = ''
        for (const s of docs[b]?.sections ?? []) {
          if (s.level === 1) unit = s.title
          else unitOf.set(`${b}:${s.id}`, unit)
        }
      }
    const lessons: ILesson[] = progress.flatMap((p) =>
      p.lessons.map((l) => {
        const k = known?.get(`${l.bookId}:${l.sectionId}`)
        return { subject: p.subject, bookId: l.bookId, sectionId: l.sectionId, title: l.title, page: l.page, endPage: l.endPage, unit: unitOf.get(`${l.bookId}:${l.sectionId}`) || undefined, state: l.state, credit: l.credit, known: !!k?.strong, ready: ready.has(`${l.bookId}:${l.sectionId}`), lastAt: l.lastAt }
      }),
    )
    const weak = new Set(progress.filter((p) => (p.mastery !== null && p.mastery < 60) || p.openMistakes >= 2).map((p) => p.subject))
    return buildIntensive({ lessons, start: saved?.start ?? iso(Date.now()), finish: saved?.finish ?? TARGET.finish, exam: saved?.exam ?? TARGET.exam, baselineMin: saved?.baselineMin, weakSubjects: weak, pastExams: PAST })
  }, [progress, ready, placement, docs, saved?.start, saved?.finish, saved?.exam, saved?.baselineMin])

  // خط الأساس يوم البدء الفعلي: بعد فهرسة كل الكتب كي يمثل المنهج كاملاً
  useEffect(() => {
    if (!student || !plan || saved || setup.phase !== 'done') return
    actions.setSettings({ intensive: { start: plan.today, finish: TARGET.finish, exam: TARGET.exam, baselineMin: plan.remainingMin } })
  }, [student, plan, saved, setup.phase])
  // مهام اليوم مثبتة مرة في اليوم
  useEffect(() => {
    if (!student || !plan || !saved || saved.today?.date === plan.today) return
    const day = plan.days.find((d) => d.date === plan.today) ?? plan.days[0]
    actions.setSettings({ intensive: { ...saved, today: { date: plan.today, sessions: day ? day.sessions : [], checked: [] } } })
  }, [student, plan, saved])

  const todaySessions = (saved?.today?.date === plan?.today ? saved?.today?.sessions : plan?.days[0]?.sessions) ?? []
  // جلسة الدرس منجزة حين يكتمل الدرس فعلاً (لا بفتحه)؛ والبقية حين يعلّمها الطالب
  const doneKeys = useMemo(() => {
    const done = new Set<string>()
    const state = new Map(progress.flatMap((p) => p.lessons.map((l) => [`${l.bookId}:${l.sectionId}`, l] as const)))
    for (const s of todaySessions) {
      if (s.kind !== 'lesson' || !s.bookId) continue
      const l = state.get(`${s.bookId}:${s.sectionId}`)
      if (!l) continue
      if (l.state === 'done' || (s.part && s.part.k < s.part.n && l.credit >= (0.6 * s.part.k) / s.part.n)) done.add(s.key)
    }
    return done
  }, [todaySessions, progress])
  return { plan, preparing: setup.phase !== 'done' && setup.phase !== 'error', todaySessions: todaySessions as Session[], checked: saved?.today?.checked ?? [], doneKeys }
}

export function toggleChecked(key: string) {
  const it = getState().data.settings.intensive
  if (!it?.today) return
  const checked = it.today.checked.includes(key) ? it.today.checked.filter((k) => k !== key) : [...it.today.checked, key]
  actions.setSettings({ intensive: { ...it, today: { ...it.today, checked } } })
}
