import type { StudentData } from '../types'
import { currentUser } from '../services/server/account'

/**
 * مواد كل طالب: أمنة كل المواد عدا العلوم الهندسية، ومحمد كل المواد عدا الأحياء (وحسابا التجربة مثلهما).
 * القاعدة نفسها في الخادم (worker/placement.mjs) تمنع الدروس والاختبارات والخطة؛ وهنا تُخفى المادة من كل الواجهة
 * دون حذف أي بيانات: ما سبق تنزيله أو حفظه يبقى كما هو ولا يظهر.
 */
const EXCLUDED: Record<string, string> = { amna: 'العلوم الهندسية', qa_bio: 'العلوم الهندسية', mohamed: 'الأحياء', qa_eng: 'الأحياء' }

export const excludedSubject = (userId = currentUser()?.role === 'student' ? currentUser()?.id : undefined) => (userId ? EXCLUDED[userId] : undefined)
export const subjectAllowed = (subject?: string, userId?: string) => {
  const x = excludedSubject(userId)
  return !x || !subject || subject !== x
}

let last: { data: StudentData; x?: string; out: StudentData } | undefined
/** بيانات الطالب كما تُعرض: دون كتب المادة المستثناة ودفاترها ومخرجاتها وأخطائها */
export function visibleData(data: StudentData): StudentData {
  const x = excludedSubject()
  if (!x) return data
  if (last && last.data === data && last.x === x) return last.out
  const hiddenBooks = new Set(data.books.filter((b) => b.subject === x).map((b) => b.id))
  const hiddenNbs = new Set(data.notebooks.filter((n) => n.subject === x || (n.bookIds.length > 0 && n.bookIds.every((id) => hiddenBooks.has(id)))).map((n) => n.id))
  if (!hiddenBooks.size && !hiddenNbs.size) return (last = { data, x, out: data }).out
  const outputs = data.outputs.filter((o) => !hiddenNbs.has(o.notebookId))
  const outIds = new Set(outputs.map((o) => o.id))
  const out: StudentData = {
    ...data,
    books: data.books.filter((b) => !hiddenBooks.has(b.id)),
    notebooks: data.notebooks.filter((n) => !hiddenNbs.has(n.id)).map((n) => (n.bookIds.some((id) => hiddenBooks.has(id)) ? { ...n, bookIds: n.bookIds.filter((id) => !hiddenBooks.has(id)) } : n)),
    outputs,
    attempts: data.attempts.filter((a) => outIds.has(a.outputId) || !data.outputs.some((o) => o.id === a.outputId)),
    studied: Object.fromEntries(Object.entries(data.studied).filter(([, s]) => !hiddenBooks.has(s.bookId))),
    mistakes: data.mistakes.filter((m) => !hiddenBooks.has(m.bookId)),
  }
  last = { data, x, out }
  return out
}
