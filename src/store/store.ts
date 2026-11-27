import { useSyncExternalStore } from 'react'
import type { Book, Flashcard, Focus, Message, Mistake, Notebook, Profile, QuizAttempt, Settings, StudentData, Studied, StudyOutput } from '../types'
import { emptyData, migrateV1 } from '../data/empty'
import { isOurKey, load, loadOld, removePrefix, save } from '../services/storage/local'
import { toast } from './toast'
import { visibleData } from '../lib/subjects'

interface AppState {
  profiles: Profile[]
  activeId: string
  data: StudentData
}

const readApp = () =>
  load<{ profiles: Profile[]; activeId: string }>('app') ??
  loadOld<{ profiles: Profile[]; activeId: string }>('app') ?? {
    profiles: [
      { id: 's1', name: 'الطالب الأول' },
      { id: 's2', name: 'الطالب الثاني' },
    ],
    activeId: 's1',
  }

const withDefaults = (d: StudentData): StudentData => {
  const base = emptyData()
  return { ...base, ...d, settings: { ...base.settings, ...d.settings } }
}
function readData(id: string): StudentData {
  const saved = load<StudentData>(`data:${id}`)
  if (saved) return withDefaults(saved)
  const old = loadOld<StudentData>(`data:${id}`)
  const fresh = old ? migrateV1(old) : emptyData()
  save(`data:${id}`, fresh)
  return fresh
}

function readState(): AppState {
  const app = readApp()
  return { ...app, data: readData(app.activeId) }
}

let state = readState()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** يُبلَّغ بكل تعديل من الطالب (للمزامنة مع الخادم وسجل النشاط) */
const changeHandlers = new Set<(before: StudentData, after: StudentData) => void>()
export const onDataChange = (f: (before: StudentData, after: StudentData) => void) => void changeHandlers.add(f)

function setData(fn: (d: StudentData) => StudentData) {
  const before = state.data
  state = { ...state, data: fn(state.data) }
  if (!save(`data:${state.activeId}`, state.data)) toast('تعذّر الحفظ. مساحة تخزين المتصفح ممتلئة أو غير متاحة.')
  emit()
  if (before !== state.data) changeHandlers.forEach((h) => h(before, state.data))
}
function setApp(patch: Partial<Pick<AppState, 'profiles' | 'activeId'>>) {
  state = { ...state, ...patch }
  save('app', { profiles: state.profiles, activeId: state.activeId })
}
const patchNotebook = (id: string, fn: (n: Notebook) => Partial<Notebook>) =>
  setData((d) => ({ ...d, notebooks: d.notebooks.map((n) => (n.id === id ? { ...n, ...fn(n) } : n)) }))

// مزامنة النوافذ المفتوحة
addEventListener('storage', (e) => {
  if (!isOurKey(e.key)) return
  state = readState()
  emit()
})

export const getState = () => state
/** الواجهة ترى بيانات الطالب دون المادة المستثناة له (lib/subjects)؛ الكتابة تبقى على البيانات كاملة فلا يُحذف شيء */
let viewOf: { s: AppState; v: AppState } | undefined
const view = () => {
  const data = visibleData(state.data)
  if (data === state.data) return state
  if (viewOf?.s !== state || viewOf.v.data !== data) viewOf = { s: state, v: { ...state, data } }
  return viewOf.v
}
export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(view()))
}
export const useData = () => useStore((s) => s.data)

/** معرّف المحادثة الحالية في الدفتر */
export const chatOf = (n: Notebook) => n.chatId ?? n.id
const chatTitle = (list: Message[] | undefined) => list?.find((m) => m.role === 'user')?.text.slice(0, 70) ?? 'محادثة'
/** مفتاح الدرس لربط محادثته به */
export const lessonKey = (f: Focus) => `${f.bookId}#${f.sectionId ?? `${f.from}-${f.to}`}`

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export type NotebookInput = Pick<Notebook, 'title' | 'subject' | 'hue' | 'bookIds'>

/** الملف مشترك على الجهاز، فلا يُحذف ما دام الطالب الآخر يستخدمه. */
async function dropUnused(ids: string[]) {
  const used = new Set(state.profiles.flatMap((p) => (p.id === state.activeId ? state.data : load<StudentData>(`data:${p.id}`))?.books.map((b) => b.id) ?? []))
  const gone = ids.filter((id) => !used.has(id))
  if (!gone.length) return
  const [{ deleteDoc }, { forgetDoc }] = await Promise.all([import('../services/books/db'), import('../services/books/process')])
  for (const id of gone) {
    forgetDoc(id)
    await deleteDoc(id).catch(() => {})
  }
}

export interface Snapshot {
  at: number
  data: StudentData
}
/** نسخة تلقائية قبل أي استيراد أو مسح */
const snapshot = () => save(`backup:${state.activeId}`, { at: Date.now(), data: state.data } satisfies Snapshot)
export const readSnapshot = (id: string) => load<Snapshot>(`backup:${id}`)

/** حساب على الخادم: معرّف الملف المحلي u:<المعرّف> */
export const accountProfile = (userId: string) => `u:${userId}`

export const actions = {
  /** الدخول بحساب: ملف مستقل على هذا الجهاز، نسخة مؤقتة من بيانات الخادم */
  enterAccount(user: { id: string; name: string }) {
    const id = accountProfile(user.id)
    // ملفات الوضع السابق على هذا الجهاز: تُعرض لاحقاً ليختار الطالب ملفه
    if (!state.activeId.startsWith('u:')) save('local-profiles', { profiles: state.profiles })
    setApp({ profiles: [{ id, name: user.name }], activeId: id })
    state = { ...state, data: readData(id) }
    emit()
  },
  /** عند الخروج تُمسح بيانات الطالب من الجهاز (تبقى على الخادم) */
  leaveAccount() {
    const id = state.activeId
    if (!id.startsWith('u:')) return
    removePrefix(`data:${id}`)
    removePrefix(`backup:${id}`)
    removePrefix(`sync:${id}`)
    setApp({ profiles: [], activeId: 'u:' })
    state = { ...state, data: emptyData() }
    emit()
  },
  /** بيانات وصلت من الخادم: تُحفظ دون أن تُعتبر تعديلاً جديداً */
  applyRemote(data: StudentData) {
    state = { ...state, data: withDefaults(data) }
    save(`data:${state.activeId}`, state.data)
    emit()
  },
  createNotebook(input: NotebookInput) {
    const now = Date.now()
    const nb: Notebook = { ...input, id: uid(), favorite: false, createdAt: now, lastOpenedAt: now }
    setData((d) => ({ ...d, notebooks: [nb, ...d.notebooks] }))
    return nb.id
  },
  editNotebook: (id: string, input: NotebookInput) => patchNotebook(id, () => input),
  deleteNotebook(id: string) {
    setData((d) => {
      const messages = { ...d.messages }
      const nb = d.notebooks.find((n) => n.id === id)
      for (const c of [id, nb?.chatId, ...(nb?.chats ?? []).map((x) => x.id)]) if (c) delete messages[c]
      const gone = new Set(d.outputs.filter((o) => o.notebookId === id).map((o) => o.id))
      return {
        ...d,
        messages,
        notebooks: d.notebooks.filter((n) => n.id !== id),
        outputs: d.outputs.filter((o) => !gone.has(o.id)),
        attempts: d.attempts.filter((a) => !gone.has(a.outputId)),
      }
    })
  },
  toggleFavorite: (id: string) => patchNotebook(id, (n) => ({ favorite: !n.favorite })),
  touchNotebook: (id: string) => patchNotebook(id, () => ({ lastOpenedAt: Date.now() })),
  linkBooks: (id: string, ids: string[]) => patchNotebook(id, (n) => ({ bookIds: [...new Set([...n.bookIds, ...ids])] })),
  unlinkBook: (id: string, bookId: string) => patchNotebook(id, (n) => ({ bookIds: n.bookIds.filter((x) => x !== bookId) })),
  addBook(book: Book) {
    setData((d) => ({ ...d, books: [book, ...d.books] }))
  },
  setBookSubject(id: string, subject: string) {
    setData((d) => ({ ...d, books: d.books.map((b) => (b.id === id ? { ...b, subject } : b)) }))
  },
  renameBook(id: string, title: string) {
    setData((d) => ({ ...d, books: d.books.map((b) => (b.id === id ? { ...b, title } : b)) }))
  },
  deleteBook(id: string) {
    setData((d) => ({
      ...d,
      books: d.books.filter((b) => b.id !== id),
      notebooks: d.notebooks.map((n) => ({ ...n, bookIds: n.bookIds.filter((x) => x !== id) })),
    }))
    void dropUnused([id])
  },
  addMessage(notebookId: string, m: Message) {
    setData((d) => ({ ...d, messages: { ...d.messages, [notebookId]: [...(d.messages[notebookId] ?? []), m] } }))
  },
  updateMessage(chatId: string, id: string, patch: Partial<Message>) {
    setData((d) => ({ ...d, messages: { ...d.messages, [chatId]: (d.messages[chatId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) } }))
  },
  clearMessages(chatId: string) {
    setData((d) => ({ ...d, messages: { ...d.messages, [chatId]: [] } }))
  },
  /** يحفظ المحادثة الحالية في السجل ويبدأ أخرى فارغة */
  newChat(notebookId: string) {
    setData((d) => {
      const nb = d.notebooks.find((n) => n.id === notebookId)
      if (!nb) return d
      const cur = chatOf(nb)
      if (!d.messages[cur]?.length) return d
      const chats = [{ id: cur, title: chatTitle(d.messages[cur]), at: d.messages[cur].at(-1)!.createdAt }, ...(nb.chats ?? []).filter((c) => c.id !== cur)]
      return { ...d, notebooks: d.notebooks.map((n) => (n.id === notebookId ? { ...n, chatId: uid(), chats } : n)) }
    })
  },
  openChat(notebookId: string, chatId: string) {
    setData((d) => {
      const nb = d.notebooks.find((n) => n.id === notebookId)
      if (!nb) return d
      const cur = chatOf(nb)
      const keep = d.messages[cur]?.length ? [{ id: cur, title: chatTitle(d.messages[cur]), at: d.messages[cur].at(-1)!.createdAt }] : []
      const chats = [...keep, ...(nb.chats ?? []).filter((c) => c.id !== chatId && c.id !== cur)]
      return { ...d, notebooks: d.notebooks.map((n) => (n.id === notebookId ? { ...n, chatId, chats } : n)) }
    })
  },
  deleteChat(notebookId: string, chatId: string) {
    setData((d) => {
      const messages = { ...d.messages }
      delete messages[chatId]
      return { ...d, messages, notebooks: d.notebooks.map((n) => (n.id === notebookId ? { ...n, chats: (n.chats ?? []).filter((c) => c.id !== chatId) } : n)) }
    })
  },
  setFocus: (id: string, focus: Focus | undefined) => patchNotebook(id, () => ({ focus })),
  /**
   * محادثة لكل درس: فتح درس يستكمل محادثته السابقة إن وُجدت، وتُحفظ محادثة الدرس السابق في السجل.
   * المحادثة الفارغة تُستعمل للدرس الجديد مباشرة.
   */
  openLesson(notebookId: string, focus: Focus) {
    const key = lessonKey(focus)
    setData((d) => {
      const nb = d.notebooks.find((n) => n.id === notebookId)
      if (!nb) return d
      const cur = chatOf(nb)
      if (nb.chatLesson === key || (!nb.chatLesson && nb.focus && lessonKey(nb.focus) === key)) return { ...d, notebooks: d.notebooks.map((n) => (n.id === notebookId ? { ...n, focus, chatLesson: key } : n)) }
      const msgs = d.messages[cur] ?? []
      let chats = nb.chats ?? []
      if (msgs.length) chats = [{ id: cur, title: nb.focus?.title ?? chatTitle(msgs), at: msgs.at(-1)!.createdAt, lesson: nb.chatLesson ?? (nb.focus ? lessonKey(nb.focus) : undefined) }, ...chats.filter((c) => c.id !== cur)]
      const prev = chats.find((c) => c.lesson === key)
      const chatId = prev ? prev.id : msgs.length ? uid() : cur
      chats = chats.filter((c) => c.id !== chatId)
      return { ...d, notebooks: d.notebooks.map((n) => (n.id === notebookId ? { ...n, focus, chatId, chats, chatLesson: key } : n)) }
    })
  },
  /** يدمج تقدم الطالب في درس */
  recordStudy(s: Omit<Studied, 'at' | 'key'> & Partial<Pick<Studied, 'key'>>) {
    const key = s.key ?? `${s.bookId}:${s.from}-${s.to}`
    setData((d) => {
      const old = d.studied[key]
      const checks = s.checks && old?.checks ? { right: old.checks.right + s.checks.right, total: old.checks.total + s.checks.total } : (s.checks ?? old?.checks)
      return { ...d, studied: { ...d.studied, [key]: { ...old, ...s, key, checks, at: Date.now() } } }
    })
  },
  addMistakes(list: Omit<Mistake, 'id' | 'at'>[]) {
    if (!list.length) return
    setData((d) => ({ ...d, mistakes: [...list.map((m) => ({ ...m, id: uid(), at: Date.now() })), ...d.mistakes].slice(0, 500) }))
  },
  resolveMistakes(ids: string[]) {
    setData((d) => ({ ...d, mistakes: d.mistakes.map((m) => (ids.includes(m.id) ? { ...m, resolved: true } : m)) }))
  },
  addOutput(o: StudyOutput) {
    setData((d) => ({ ...d, outputs: [o, ...d.outputs] }))
  },
  /** الملاحظات والملخصات والمقارنات قابلة للتعديل */
  editNote(id: string, title: string, text: string) {
    setData((d) => ({ ...d, outputs: d.outputs.map((o) => (o.id === id && (o.data.kind === 'note' || o.data.kind === 'summary' || o.data.kind === 'compare') ? { ...o, title, data: { ...o.data, text } } : o)) }))
  },
  setCards(outputId: string, cards: Flashcard[]) {
    setData((d) => ({
      ...d,
      outputs: d.outputs.map((o) => (o.id === outputId && o.data.kind === 'cards' ? { ...o, data: { ...o.data, cards, known: cards.filter((c) => (c.box ?? 0) >= 3).map((c) => c.id) } } : o)),
    }))
  },
  deleteOutput(id: string) {
    setData((d) => ({
      ...d,
      outputs: d.outputs.filter((o) => o.id !== id),
      attempts: d.attempts.filter((a) => a.outputId !== id),
    }))
  },
  setKnown(outputId: string, known: string[]) {
    setData((d) => ({
      ...d,
      outputs: d.outputs.map((o) => (o.id === outputId && o.data.kind === 'cards' ? { ...o, data: { ...o.data, known } } : o)),
    }))
  },
  addAttempt(a: Omit<QuizAttempt, 'id' | 'at'>) {
    setData((d) => ({ ...d, attempts: [{ ...a, id: uid(), at: Date.now() }, ...d.attempts] }))
  },
  setSettings(patch: Partial<Settings>) {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
  },
  switchProfile(id: string) {
    if (id === state.activeId) return
    setApp({ activeId: id })
    state = { ...state, data: readData(id) }
    emit()
  },
  renameProfile(id: string, name: string) {
    setApp({ profiles: state.profiles.map((p) => (p.id === id ? { ...p, name } : p)) })
    emit()
  },
  /** يستبدل بيانات الطالب الحالي فقط، بعد حفظ نسخة منها */
  importData(data: StudentData): boolean {
    if (!snapshot()) return false
    setData(() => data)
    return true
  },
  /** الكتب لا تُمسح هنا كي تبقى النسخة قابلة للاستعادة */
  clearAll(): boolean {
    if (!snapshot()) return false
    setData((d) => ({ ...emptyData(), books: d.books, settings: d.settings }))
    return true
  },
  restoreSnapshot(): boolean {
    const s = readSnapshot(state.activeId)
    if (!s) return false
    const current = state.data
    setData(() => withDefaults(s.data))
    save(`backup:${state.activeId}`, { at: Date.now(), data: current } satisfies Snapshot)
    return true
  },
}
