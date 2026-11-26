import { useSyncExternalStore } from 'react'
import type { Book, Message, Notebook, Profile, QuizAttempt, Settings, StudentData, StudyOutput } from '../types'
import { emptyData, migrateV1 } from '../data/empty'
import { isOurKey, load, loadOld, save } from '../services/storage/local'
import { toast } from './toast'

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

function setData(fn: (d: StudentData) => StudentData) {
  state = { ...state, data: fn(state.data) }
  if (!save(`data:${state.activeId}`, state.data)) toast('تعذّر الحفظ. مساحة تخزين المتصفح ممتلئة أو غير متاحة.')
  emit()
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
export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}
export const useData = () => useStore((s) => s.data)

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

export const actions = {
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
      delete messages[id]
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
  clearMessages(notebookId: string) {
    setData((d) => ({ ...d, messages: { ...d.messages, [notebookId]: [] } }))
  },
  addOutput(o: StudyOutput) {
    setData((d) => ({ ...d, outputs: [o, ...d.outputs] }))
  },
  editNote(id: string, title: string, text: string) {
    setData((d) => ({ ...d, outputs: d.outputs.map((o) => (o.id === id && o.data.kind === 'note' ? { ...o, title, data: { ...o.data, text } } : o)) }))
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
