import { useSyncExternalStore } from 'react'
import { HUE_OF } from '../../lib/study'
import { actions, getState } from '../../store/store'
import { save } from '../storage/local'
import { serverLibraryCode } from '../server/account'
import { syncPacks } from '../study/lessonPack'
import { installIndex, openLibrary, savedCode } from './library'
import { docsReady, getDocs } from './process'

/**
 * المنهج جاهز من أول دخول: كتب المكتبة كلها (فهارسها فقط، نحو ٢ ميغابايت)، ودفتر لكل مادة،
 * والمحتوى الجاهز للدروس. لا يرفع الطالب كتاباً ولا ينشئ دفتراً بنفسه.
 * لا يحذف شيئاً: الكتاب أو الدفتر الموجود يبقى كما هو.
 */
type State = { phase: 'idle' | 'books' | 'lessons' | 'done' | 'error'; done: number; total: number }
let state: State = { phase: 'idle', done: 0, total: 0 }
const subs = new Set<() => void>()
const set = (s: Partial<State>) => {
  state = { ...state, ...s }
  subs.forEach((l) => l())
}
export const useCurriculum = () =>
  useSyncExternalStore(
    (l) => (subs.add(l), () => void subs.delete(l)),
    () => state,
  )

let running: Promise<void> | undefined
export function setupCurriculum(): Promise<void> {
  running ??= (async () => {
    const profileId = getState().activeId
    try {
      let code = savedCode()
      if (!code) {
        code = (await serverLibraryCode().catch(() => null)) ?? ''
        if (code) save('library-code', code)
      }
      if (!code) return set({ phase: 'error' })
      await docsReady
      const items = await openLibrary(code)
      const todo = items.filter((i) => !getDocs()[i.id]?.chunkCount)
      set({ phase: 'books', done: 0, total: todo.length })
      for (const [k, item] of todo.entries()) {
        await installIndex(code, item).catch(() => false)
        set({ done: k + 1 })
      }
      if (getState().activeId !== profileId) return
      // كتب المنهج في قائمة الطالب، وكل كتاب جديد في دفتر مادته
      const added: string[] = []
      for (const item of items) {
        if (!getDocs()[item.id]?.chunkCount) continue
        const has = getState().data.books.find((b) => b.id === item.id)
        if (!has) {
          actions.addBook({ id: item.id, title: item.title, kind: 'pdf', sizeBytes: item.size, addedAt: Date.now(), subject: item.subject })
          added.push(item.id)
        } else if (!has.subject && item.subject) actions.setBookSubject(item.id, item.subject)
      }
      const subjects = [...new Set(items.map((i) => i.subject))]
      for (const subject of subjects) {
        const ids = items.filter((i) => i.subject === subject && getDocs()[i.id]?.chunkCount).map((i) => i.id)
        if (!ids.length) continue
        const nb = getState().data.notebooks.find((n) => n.subject === subject)
        if (!nb) actions.createNotebook({ title: subject, subject, hue: HUE_OF[subject] ?? 'violet', bookIds: ids })
        else {
          const fresh = ids.filter((id) => added.includes(id) && !nb.bookIds.includes(id))
          if (fresh.length) actions.linkBooks(nb.id, fresh)
        }
      }
      set({ phase: 'lessons' })
      await syncPacks()
      set({ phase: 'done' })
    } catch {
      set({ phase: 'error' })
    }
  })().finally(() => (running = undefined))
  return running
}
