import { useMemo } from 'react'
import { lessonsOfSections } from '../../lib/planner'
import { computeProgress, type PInput, type SubjectProgress } from '../../lib/progress'
import { subjectAllowed } from '../../lib/subjects'
import type { Section } from '../books/types'
import { useDocs } from '../books/process'
import { useData } from '../../store/store'
import { usePacks } from './lessonPack'
import { usePlacement, type SubjectResult } from './placement'

export const SUBJECT_ORDER = ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء', 'العلوم الهندسية', 'اللغة العربية', 'اللغة الإنجليزية', 'التربية الإسلامية']

interface Core {
  studied: PInput['studied']
  attempts: PInput['attempts']
  outputs: PInput['outputs']
  mistakes: PInput['mistakes']
}
/** مدخلات حساب التقدم من بيانات طالب (جهازه، أو نسخته في الخادم للمسؤول) */
export function progressInput(books: { id: string; title: string; subject?: string }[], sectionsOf: (id: string) => Section[] | undefined, core: Core, placement?: SubjectResult[], ready?: Set<string>, userId?: string): PInput {
  const by = new Map<string, PInput['subjects'][number]['books']>()
  for (const b of books) {
    const subject = b.subject ?? ''
    if (!subject || !subjectAllowed(subject, userId)) continue
    const sections = sectionsOf(b.id) ?? []
    const lessons = lessonsOfSections(sections).map((s) => ({ bookId: b.id, sectionId: s.id, title: s.title, page: s.page, endPage: s.endPage }))
    if (!lessons.length) continue
    by.set(subject, [...(by.get(subject) ?? []), { id: b.id, title: b.title, lessons }])
  }
  const subjects = [...by.entries()].sort((a, b) => ((SUBJECT_ORDER.indexOf(a[0]) + 99) % 99) - ((SUBJECT_ORDER.indexOf(b[0]) + 99) % 99)).map(([subject, books]) => ({ subject, books }))
  return { subjects, studied: core.studied ?? {}, attempts: core.attempts ?? [], outputs: core.outputs ?? [], mistakes: core.mistakes ?? [], placement: placement?.map((r) => ({ items: r.items })), ready }
}

/** تقدم الطالب الحالي في مواده، يُحسب من بياناته على الجهاز ويتحدث تلقائياً مع كل درس أو اختبار أو مراجعة */
export function useSubjectProgress(): { progress: SubjectProgress[]; ready: Set<string> } {
  const data = useData()
  const docs = useDocs()
  const packs = usePacks()
  const placement = usePlacement()
  return useMemo(() => {
    const ready = new Set(packs.index.map((p) => `${p.bookId}:${p.sectionId}`))
    const input = progressInput(data.books, (id) => docs[id]?.sections, data, placement?.results, ready.size ? ready : undefined)
    return { progress: computeProgress(input), ready }
  }, [data, docs, packs.index, placement])
}
