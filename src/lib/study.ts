import { go } from '../router'
import type { DocMeta, Section } from '../services/books/types'
import type { Ask } from '../services/study/tutor'
import { actions, getState } from '../store/store'
import type { Focus, Hue } from '../types'

/** طلب ينتظر أن تفتح المحادثة: من الرئيسية أو القارئ أو صفحة التقدم */
let pending: { notebookId: string; ask: Ask & { quote?: string } } | null = null
const listeners = new Set<() => void>()
export function queueAsk(notebookId: string, ask: Ask & { quote?: string }) {
  pending = { notebookId, ask }
  listeners.forEach((l) => l())
}
export function takeAsk(notebookId: string) {
  if (pending?.notebookId !== notebookId) return null
  const a = pending.ask
  pending = null
  return a
}
export function onAsk(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

const HUE_OF: Record<string, Hue> = { الفيزياء: 'indigo', الكيمياء: 'teal', الأحياء: 'olive', الرياضيات: 'violet', 'اللغة العربية': 'clay', 'اللغة الإنجليزية': 'plum', 'التربية الإسلامية': 'olive', 'العلوم الهندسية': 'indigo' }

/** دفتر المادة: يُستخدم الموجود، أو يُنشأ دفتر باسم المادة يضم الكتاب */
export function notebookFor(bookId: string) {
  const { notebooks, books } = getState().data
  const book = books.find((b) => b.id === bookId)
  const recent = [...notebooks].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const has = recent.find((n) => n.bookIds.includes(bookId))
  if (has) return has.id
  const subject = book?.subject ?? book?.title ?? 'عام'
  const same = recent.find((n) => n.subject === subject)
  if (same) {
    actions.linkBooks(same.id, [bookId])
    return same.id
  }
  return actions.createNotebook({ title: subject, subject, hue: HUE_OF[subject] ?? 'violet', bookIds: [bookId] })
}

export const focusOf = (bookId: string, s: Section): Focus => ({ bookId, from: s.page, to: s.endPage, title: s.title, sectionId: s.id })

/** الدروس فقط إن وُجدت، وإلا الوحدات */
export function lessonsOf(d?: DocMeta) {
  return d?.sections ?? []
}

/** يفتح دفتر الكتاب على الدرس، وينفذ الطلب إن وُجد */
export function startStudy(bookId: string, focus?: Focus, ask?: Ask & { quote?: string }) {
  const id = notebookFor(bookId)
  if (focus) actions.setFocus(id, focus)
  if (ask) queueAsk(id, ask)
  go(`/notebooks/${id}`)
  return id
}
