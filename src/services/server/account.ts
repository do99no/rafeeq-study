import { useSyncExternalStore } from 'react'
import { getAI } from '../ai/manager'
import { load, remove, save } from '../storage/local'

/**
 * حسابات الطالبين على الخادم. إذا لم يكن الخادم مهيأً للحسابات يبقى رفيق في الوضع المحلي كما كان.
 * الجلسة رمز عشوائي يحفظه هذا الجهاز؛ كلمة المرور لا تُحفظ أبداً.
 */
export interface User {
  id: string
  role: 'student' | 'admin'
  name: string
}
export interface Status {
  accounts: boolean
  setup?: boolean
  students?: { id: string; name: string; ready: boolean }[]
}
interface Session {
  token: string
  expires: number
  user: User
}
interface AccountState {
  /** checking: يُفحص الخادم. local: دون حسابات. accounts: الحسابات مفعلة */
  mode: 'checking' | 'local' | 'accounts'
  status: Status | null
  session: Session | null
  /** تعذر الوصول إلى الخادم الآن (يعمل الطالب بما على جهازه) */
  offline: boolean
}

let state: AccountState = {
  mode: 'checking',
  status: load<Status>('accounts'),
  session: load<Session>('session'),
  offline: false,
}
if (state.session && state.session.expires < Date.now()) state.session = null
const listeners = new Set<() => void>()
const set = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const useAccount = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => state,
  )
export const getAccount = () => state
export const sessionToken = () => state.session?.token ?? null
export const currentUser = () => state.session?.user ?? null

const base = () => getAI().config.url.replace(/\/+$/, '')

export class ServerError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code)
  }
}
/** نهاية الجلسة تُبلَّغ إلى من يهمه (مسح بيانات الجهاز) */
const expiredHandlers = new Set<() => void>()
export const onSessionEnd = (f: () => void) => void expiredHandlers.add(f)

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; keepalive?: boolean; signal?: AbortSignal; raw?: string } = {}): Promise<T> {
  const url = base()
  if (!url) throw new ServerError('no_server', 0)
  let res: Response
  try {
    res = await fetch(url + path, {
      method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? 'POST' : 'GET'),
      headers: { ...(state.session ? { authorization: `Bearer s:${state.session.token}` } : {}), ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      keepalive: opts.keepalive,
      signal: opts.signal,
      cache: 'no-store',
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    if (!state.offline) set({ offline: true })
    throw new ServerError('network', 0)
  }
  if (state.offline) set({ offline: false })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && j.code === 'session' && state.session) endLocal()
    throw new ServerError(j.code ?? 'server', res.status, j)
  }
  return j as T
}

/** يحدد الوضع عند فتح التطبيق. الحالة المحفوظة تسمح بالعمل دون اتصال. */
export async function initAccounts() {
  if (!base()) return set({ mode: state.session ? 'accounts' : 'local' })
  try {
    const s = await api<Status>('/auth/status', { signal: AbortSignal.timeout(8000) })
    save('accounts', s)
    set({ status: s, mode: s.accounts ? 'accounts' : 'local' })
    // جلسة محفوظة: يتأكد الخادم منها
    if (s.accounts && state.session) await api('/auth/me').catch((e) => e instanceof ServerError && e.status === 401 && endLocal())
  } catch {
    // دون اتصال: الحسابات المعروفة سابقاً تبقى، والجلسة المحفوظة تكفي للدراسة بما على الجهاز
    set({ mode: state.status?.accounts || state.session ? 'accounts' : 'local', offline: true })
  }
}

export async function login(id: string, password: string) {
  const r = await api<Session & { user: User }>('/auth/login', { body: { id, password } })
  const session = { token: r.token, expires: r.expires, user: r.user }
  save('session', session)
  set({ session, mode: 'accounts' })
  return r.user
}

/** يمسح الجلسة وبيانات الطالب المخزنة على هذا الجهاز */
function endLocal() {
  remove('session')
  set({ session: null })
  expiredHandlers.forEach((f) => f())
}
export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {})
  endLocal()
}
export const setupAdmin = (code: string, password: string) => api('/auth/setup', { body: { code, password } })
export const changePassword = (current: string, next: string) => api('/auth/password', { body: { current, next } })
export const refreshStatus = async () => {
  const s = await api<Status>('/auth/status')
  save('accounts', s)
  set({ status: s })
  return s
}
/** رمز المكتبة من الخادم إن أعدّه المسؤول، فلا يكتبه الطالب */
export const serverLibraryCode = () => api<{ library: string | null }>('/auth/me').then((r) => r.library)
