import { useSyncExternalStore } from 'react'
import { emptyData } from '../../data/empty'
import { actions, getState, onDataChange } from '../../store/store'
import type { Message, StudentData } from '../../types'
import { load, save } from '../storage/local'
import { api, getAccount, ServerError } from './account'

/**
 * مزامنة بيانات الطالب مع الخادم: «core» = كل شيء عدا الرسائل، و«chat:<id>» لكل محادثة.
 * كل جزء له رقم نسخة؛ التعارض (جهازان) يُدمج بالمعرّفات ولا يُفقد شيء.
 */
type Meta = Record<string, { v: number; h: string }>
type SyncState = 'idle' | 'saving' | 'offline' | 'error'

let status: SyncState = 'idle'
let lastSynced = 0
const listeners = new Set<() => void>()
const setStatus = (s: SyncState) => {
  status = s
  if (s === 'idle') lastSynced = Date.now()
  listeners.forEach((l) => l())
}
export const useSync = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => status,
  )
export const lastSync = () => lastSynced

const metaKey = () => `sync:${getState().activeId}`
const readMeta = (): Meta => load<Meta>(metaKey()) ?? {}
const writeMeta = (m: Meta) => save(metaKey(), m)

/** بصمة سريعة للتعرف على الأجزاء المتغيرة */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `${s.length}:${(h >>> 0).toString(36)}`
}

const coreOf = (d: StudentData) => {
  const { messages: _m, ...core } = d
  void _m
  return core
}
function parts(d: StudentData): Record<string, string> {
  const out: Record<string, string> = { core: JSON.stringify(coreOf(d)) }
  for (const [id, list] of Object.entries(d.messages)) if (list.length && /^[A-Za-z0-9_-]{1,40}$/.test(id)) out[`chat:${id}`] = JSON.stringify(list)
  return out
}

/** دمج بالمعرّفات: ما في الجهاز يغلب عند التساوي، ولا يُحذف شيء موجود في أحد الطرفين */
const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []) => {
  const m = new Map(a.map((x) => [x.id, x]))
  for (const x of b) m.set(x.id, x)
  return [...m.values()]
}
export function mergeCore(server: Partial<StudentData>, local: StudentData): Omit<StudentData, 'messages'> {
  const studied = { ...(server.studied ?? {}) }
  for (const [k, v] of Object.entries(local.studied)) if (!studied[k] || v.at >= studied[k].at) studied[k] = v
  return {
    notebooks: byId(server.notebooks, local.notebooks),
    books: byId(server.books, local.books),
    outputs: byId(server.outputs, local.outputs).sort((a, b) => b.createdAt - a.createdAt),
    attempts: byId(server.attempts, local.attempts).sort((a, b) => b.at - a.at),
    mistakes: byId(server.mistakes, local.mistakes).sort((a, b) => b.at - a.at),
    settings: { ...emptyData().settings, ...server.settings, ...local.settings },
    studied,
  }
}
const mergeChat = (server: Message[], local: Message[]) => byId(server, local).sort((a, b) => a.createdAt - b.createdAt)

let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | null = null
let again = false

/** يرفع ما تغير. يُستدعى بعد كل تعديل (مع تأخير قصير) */
export function schedule(ms = 1500) {
  if (!getState().activeId.startsWith('u:') || getAccount().session?.user.role !== 'student') return
  clearTimeout(timer)
  timer = setTimeout(() => void push(), ms)
}

async function push(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    const owner = getState().activeId
    const meta = readMeta()
    const now = parts(getState().data)
    const changed = Object.entries(now).filter(([k, json]) => meta[k]?.h !== hash(json))
    const removed = Object.keys(meta).filter((k) => k.startsWith('chat:') && !(k in now))
    if (!changed.length && !removed.length) return setStatus('idle')
    setStatus('saving')
    try {
      for (const [key, json] of changed) {
        if (getState().activeId !== owner) return
        try {
          const r = await api<{ v: number }>(`/data/${encodeURIComponent(key)}`, { method: 'PUT', raw: JSON.stringify({ json, base: meta[key]?.v ?? 0 }) })
          meta[key] = { v: r.v, h: hash(json) }
        } catch (e) {
          if (!(e instanceof ServerError) || e.status !== 409) throw e
          // تعديل من جهاز آخر: دمج ثم رفع الناتج
          const server = e.extra.json ? JSON.parse(e.extra.json as string) : null
          const d = getState().data
          if (key === 'core') actions.applyRemote({ ...d, ...mergeCore(server ?? {}, d) })
          else {
            const id = key.slice(5)
            actions.applyRemote({ ...d, messages: { ...d.messages, [id]: mergeChat(server ?? [], d.messages[id] ?? []) } })
          }
          const merged = parts(getState().data)[key]
          const r = await api<{ v: number }>(`/data/${encodeURIComponent(key)}`, { method: 'PUT', raw: JSON.stringify({ json: merged, base: e.extra.v as number }) })
          meta[key] = { v: r.v, h: hash(merged) }
        }
        writeMeta(meta)
      }
      for (const key of removed) {
        await api(`/data/${encodeURIComponent(key)}`, { method: 'DELETE' })
        delete meta[key]
        writeMeta(meta)
      }
      setStatus('idle')
    } catch (e) {
      setStatus(e instanceof ServerError && e.code === 'network' ? 'offline' : 'error')
      // إعادة المحاولة لاحقاً: ما في الجهاز محفوظ فيه حتى يصل
      clearTimeout(timer)
      timer = setTimeout(() => void push(), 30_000)
    }
  })().finally(() => {
    running = null
    if (again) {
      again = false
      void push()
    }
  })
  return running
}

/**
 * يجلب بيانات الطالب من الخادم ويدمجها بما على الجهاز.
 * @returns هل كانت للطالب بيانات على الخادم
 */
export async function pull(): Promise<boolean> {
  const { docs } = await api<{ docs: { key: string; json: string; v: number }[] }>('/data')
  const meta = readMeta()
  const local = getState().data
  const localParts = parts(local)
  let data: StudentData = { ...local, messages: { ...local.messages } }
  for (const d of docs) {
    const dirty = localParts[d.key] !== undefined && meta[d.key]?.h !== hash(localParts[d.key])
    const server = JSON.parse(d.json)
    if (d.key === 'core') data = { ...data, ...(dirty ? mergeCore(server, data) : { ...emptyData(), ...server, messages: undefined }), messages: data.messages }
    else {
      const id = d.key.slice(5)
      data.messages[id] = dirty ? mergeChat(server, data.messages[id] ?? []) : server
    }
    meta[d.key] = { v: d.v, h: dirty ? '' : hash(d.json) }
  }
  writeMeta(meta)
  actions.applyRemote(data)
  // الأجزاء المحلية الجديدة أو المدموجة تُرفع
  schedule(200)
  return docs.length > 0
}

let wired = false
export function startSync() {
  if (wired) return
  wired = true
  onDataChange(() => schedule())
  addEventListener('online', () => schedule(500))
  // قبل إغلاق الصفحة: محاولة أخيرة
  addEventListener('pagehide', () => {
    if (status !== 'idle') void push()
  })
}
