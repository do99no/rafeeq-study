import { useSyncExternalStore } from 'react'
import { load, save } from '../storage/local'
import { readSse } from './sse'
import { AIError, type ChatMsg, type ErrorCode, type Health, type Provider, type ProviderInfo, type Task } from './types'

/** إعدادات الجهاز (ليست بيانات طالب). رمز الوصول ليس مفتاح API. */
interface Config {
  url: string
  code: string
  order: string[]
  off: string[]
  ollama: { on: boolean; model: string; embedModel: string }
}
const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'cloudflare', 'sambanova', 'cohere', 'nvidia', 'mistral', 'ollama']
const envUrl: string = import.meta.env.VITE_WORKER_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

const saved = load<Partial<Config>>('ai')
let config: Config = {
  url: saved?.url ?? envUrl,
  code: saved?.code ?? '',
  order: [...(saved?.order ?? []), ...DEFAULT_ORDER.filter((x) => !saved?.order?.includes(x))],
  off: saved?.off ?? [],
  ollama: saved?.ollama ?? { on: false, model: '', embedModel: '' },
}
let health: Record<string, Health> = load('ai-health') ?? {}
let infos: ProviderInfo[] = []
let service: { state: 'unset' | 'checking' | 'ok' | 'error'; code?: ErrorCode } = { state: config.url && config.code ? 'checking' : 'unset' }

let snapshot = { config, health, infos, service }
const listeners = new Set<() => void>()
const emit = () => {
  snapshot = { config, health, infos, service }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useAI = () => useSyncExternalStore(subscribe, () => snapshot)
export const getAI = () => snapshot

export function setConfig(patch: Partial<Config>) {
  config = { ...config, ...patch }
  save('ai', config)
  emit()
}

const COOL: Partial<Record<ErrorCode, number>> = {
  rate: 60, quota: 3600, model: 3600, server: 30, timeout: 45, network: 30,
}
function setHealth(key: string, h: Health) {
  health = { ...health, [key]: h }
  save('ai-health', health)
  emit()
}
function fail(key: string, e: AIError) {
  // المفتاح غير الصالح يتوقف حتى يُفحص يدوياً؛ بقية الأخطاء تنتظر مدتها
  const secs = e.code === 'auth' ? 10 * 365 * 86400 : e.code === 'rate' || e.code === 'quota' ? (e.retryAfter ?? COOL[e.code]!) : (e.retryAfter ?? COOL[e.code] ?? 0)
  setHealth(key, { ...health[key], ok: false, code: e.code, at: Date.now(), until: Date.now() + secs * 1000 })
}
function succeed(key: string) {
  const day = new Date().toISOString().slice(0, 10)
  const h = health[key]
  setHealth(key, { ok: true, at: Date.now(), day, used: (h?.day === day ? (h.used ?? 0) : 0) + 1 })
}
export const coolingUntil = (key: string) => {
  const u = health[key]?.until ?? 0
  return u > Date.now() ? u : 0
}
export function resetHealth() {
  health = {}
  save('ai-health', health)
  emit()
}

const WORKER_CODES: ErrorCode[] = ['access', 'worker_setup']

async function call(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const url = config.url.replace(/\/+$/, '')
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw new AIError('worker_url')
  let res: Response
  try {
    res = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${encodeURIComponent(config.code)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (signal.aborted) throw e
    throw new AIError('worker_down')
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new AIError(j.code ?? 'worker_down', j.retryAfter)
  }
  return res
}

function viaWorker(info: ProviderInfo): Provider {
  return {
    info,
    async *chat(messages, { maxTokens, signal }) {
      yield* readSse(await call('/chat', { provider: info.id, messages, maxTokens }, signal))
    },
    async embed(texts, signal) {
      return (await call('/embed', { provider: info.id, texts }, signal)).json()
    },
    async rerank(query, docs, signal) {
      return (await (await call('/rerank', { provider: info.id, query, docs }, signal)).json()).order
    },
  }
}

const OLLAMA = 'http://localhost:11434/v1'
function ollama(): Provider {
  const post = async (path: string, body: unknown, signal: AbortSignal) => {
    const res = await fetch(OLLAMA + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }).catch((e) => {
      if (signal.aborted) throw e
      throw new AIError('network')
    })
    if (!res.ok) throw new AIError(res.status === 404 ? 'model' : 'server')
    return res
  }
  const { model, embedModel } = config.ollama
  return {
    info: { id: 'ollama', name: 'Ollama (محلي)', configured: config.ollama.on && !!model, models: { ...(model ? { chat: model } : {}), ...(embedModel ? { embed: embedModel } : {}) }, embedBatch: 16 },
    async *chat(messages, { maxTokens, signal }) {
      yield* readSse(await post('/chat/completions', { model, messages, stream: true, temperature: 0.2, max_tokens: maxTokens }, signal))
    },
    async embed(texts, signal) {
      const j = await (await post('/embeddings', { model: embedModel, input: texts }, signal)).json()
      const vectors = j.data.map((d: { embedding: number[] }) => d.embedding)
      return { model: `ollama:${embedModel}:${vectors[0].length}`, vectors }
    },
  }
}

export function providers(): Provider[] {
  const list = [...infos.map(viaWorker), ollama()]
  const rank = (id: string) => {
    const i = config.order.indexOf(id)
    return i < 0 ? 99 : i
  }
  return list.sort((a, b) => rank(a.info.id) - rank(b.info.id))
}
const usable = (task: Task) => providers().filter((p) => p.info.configured && p.info.models[task] && !config.off.includes(p.info.id))
const keyOf = (p: Provider, task: Task) => `${p.info.id}:${task}`

export const hasTask = (task: Task) => usable(task).length > 0

/** يفحص الوسيط فقط؛ لا يستهلك حصة أي مزود. */
export async function refresh(manual = false) {
  if (manual) resetHealth()
  if (!config.url || !config.code) {
    infos = []
    service = { state: 'unset' }
    return emit()
  }
  service = { state: 'checking' }
  emit()
  try {
    const j = await (await call('/status', null, AbortSignal.timeout(12_000))).json()
    infos = j.providers
    service = { state: 'ok' }
  } catch (e) {
    service = { state: 'error', code: e instanceof AIError ? e.code : 'worker_down' }
  }
  emit()
}

let first: Promise<void> | undefined
/** يُستدعى قبل أول طلب؛ يعيد المحاولة إن كان الوسيط متعطلاً */
async function ensure() {
  if (service.state === 'ok') return
  first ??= refresh().finally(() => (first = undefined))
  await first
}

const toAI = (e: unknown) => (e instanceof AIError ? e : new AIError('network'))

export class Unavailable extends Error {
  constructor(public reason: 'unset' | 'service' | 'all', public until?: number) {
    super('unavailable')
  }
}
function unavailable(task: Task): Unavailable {
  const list = usable(task)
  if (!list.length) return new Unavailable(service.state === 'error' ? 'service' : 'unset')
  const soon = list.map((p) => coolingUntil(keyOf(p, task))).filter((t) => t && t < Date.now() + 86400_000)
  return new Unavailable('all', soon.length ? Math.min(...soon) : undefined)
}

export type ChatEvent = { type: 'text'; text: string } | { type: 'reset' } | { type: 'provider'; name: string }

/** يجرّب المزودين بالترتيب مع إعادة إرسال السياق كاملاً، دون تدخل الطالب. */
export async function* chat(messages: ChatMsg[], opts: { maxTokens?: number; signal: AbortSignal }): AsyncGenerator<ChatEvent> {
  await ensure()
  let workerDead = false
  for (const p of usable('chat')) {
    const key = keyOf(p, 'chat')
    const local = p.info.id === 'ollama'
    if (coolingUntil(key) || (workerDead && !local)) continue
    let started = false
    try {
      for await (const text of p.chat!(messages, opts)) {
        if (!started) yield { type: 'provider', name: p.info.name }
        started = true
        yield { type: 'text', text }
      }
      succeed(key)
      return
    } catch (e) {
      if (opts.signal.aborted) throw e
      const err = toAI(e)
      if (err.code === 'worker_down' || err.code === 'worker_url' || WORKER_CODES.includes(err.code)) {
        workerDead = true
        service = { state: 'error', code: err.code }
        emit()
      } else fail(key, err)
      if (started) yield { type: 'reset' }
    }
  }
  throw unavailable('chat')
}

/** التضمين: لا يُستبدل مزود بآخر لأن متجهات النماذج غير متوافقة. */
export async function embed(texts: string[], signal: AbortSignal, model?: string): Promise<{ model: string; vectors: number[][] }> {
  await ensure()
  const list = usable('embed').filter((p) => !model || model.startsWith(`${p.info.id}:${p.info.models.embed}:`))
  for (const p of list) {
    const key = keyOf(p, 'embed')
    if (coolingUntil(key)) continue
    try {
      const r = await p.embed!(texts, signal)
      if (model && r.model !== model) throw new AIError('model')
      succeed(key)
      return r
    } catch (e) {
      if (signal.aborted) throw e
      const err = toAI(e)
      if (err.code === 'worker_down' || WORKER_CODES.includes(err.code)) break
      fail(key, err)
    }
  }
  const soon = list.map((p) => coolingUntil(keyOf(p, 'embed'))).filter(Boolean)
  throw new Unavailable('all', soon.length ? Math.min(...soon) : undefined)
}
/** دفعة تناسب أضيق مزود مفعّل */
export const embedBatch = () => Math.min(32, ...usable('embed').map((p) => p.info.embedBatch ?? 16))

/** تحسين اختياري: أي فشل يعيد الترتيب الأصلي. */
export async function rerank(query: string, docs: string[], signal: AbortSignal): Promise<number[] | null> {
  await ensure()
  for (const p of usable('rerank')) {
    const key = keyOf(p, 'rerank')
    if (coolingUntil(key)) continue
    try {
      const order = await p.rerank!(query, docs, signal)
      if (!order.every((i) => Number.isInteger(i) && i >= 0 && i < docs.length)) throw new AIError('server')
      succeed(key)
      return order
    } catch (e) {
      if (signal.aborted) throw e
      const err = toAI(e)
      if (err.code === 'worker_down' || WORKER_CODES.includes(err.code)) return null
      fail(key, err)
    }
  }
  return null
}

export const ERROR_TEXT: Record<ErrorCode, string> = {
  auth: 'المفتاح غير صالح أو منتهي',
  quota: 'انتهت الحصة مؤقتاً',
  rate: 'طلبات كثيرة، ينتظر قليلاً',
  too_large: 'النص أطول من حد النموذج',
  model: 'النموذج غير متاح',
  timeout: 'تأخر الرد',
  server: 'عطل لدى المزود',
  network: 'تعذّر الاتصال بالمزود',
  bad_request: 'رفض المزود الطلب',
  not_configured: 'لم يُضف مفتاح',
  access: 'رمز الوصول غير صحيح',
  worker_setup: 'الخدمة تحتاج إلى إعداد رمز الوصول',
  worker_down: 'تعذّر الوصول إلى الخدمة',
  worker_url: 'عنوان الخدمة غير صالح',
}

void refresh()
addEventListener('online', () => void refresh())
