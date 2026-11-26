/** وسيط صغير يحمي المفاتيح ويمرر الطلبات. لا يخزن أسئلة الطالب ولا يسجلها. */
import { PROVIDERS, isConfigured, modelOf } from './providers.mjs'

// صور الصفحات تكبر الطلب: حتى 4 صور JPEG
const MAX_BODY = 6_000_000
const MAX_IMAGES = 4
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
const FIRST_BYTE_MS = 40_000

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code)
    Object.assign(this, { status, body: { code, ...extra } })
  }
}

const same = async (a, b) => {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = [await h(a), await h(b)]
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

const retryAfter = (res, body) => {
  const h = res.headers.get('retry-after')
  if (h) {
    const s = Number(h)
    const v = Number.isFinite(s) ? s : (Date.parse(h) - Date.now()) / 1000
    if (v > 0) return Math.ceil(v)
  }
  const m = body.match(/retryDelay"?\s*:\s*"?([\d.]+)s/) ?? body.match(/try again in ([\d.]+)\s*s/i)
  return m ? Math.ceil(Number(m[1])) : undefined
}

/** تصنيف الخطأ: كل نوع يعالجه المدير بطريقة مختلفة */
export function classify(status, body) {
  const b = body.toLowerCase()
  if (status === 401 || status === 403 || (status === 400 && /api[ _]key (not valid|expired|invalid)|api_key_invalid/.test(b))) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return /per ?day|daily|rpd|tokens per month|insufficient|neurons|free-models-per-day/.test(b) ? 'quota' : 'rate'
  if (status === 413 || /context.{0,20}(length|window)|too many tokens|maximum context/.test(b)) return 'too_large'
  if (status === 404 || status === 410 || /model.{0,60}(not found|does not exist|decommission|deprecated|not supported)/.test(b)) return 'model'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'server'
  return 'bad_request'
}

async function upstream(url, key, body, signal) {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, FIRST_BYTE_MS)
  const stop = () => ctrl.abort()
  signal?.addEventListener('abort', stop)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch {
    throw new HttpError(502, timedOut ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 4000)
    // لا نمرر نص الخطأ الأصلي: قد يحتوي معلومات الحساب
    throw new HttpError(502, classify(res.status, text), { upstream: res.status, retryAfter: retryAfter(res, text) })
  }
  return res
}

function pick(id, task, env) {
  const p = Object.hasOwn(PROVIDERS, id ?? '') ? PROVIDERS[id] : null
  if (!p || !p[task]) throw new HttpError(400, 'bad_request')
  if (!isConfigured(id, env)) throw new HttpError(400, 'not_configured')
  const model = modelOf(id, task, env)
  if (p.freeOnly && !p.freeOnly.test(model)) throw new HttpError(400, 'model')
  const override = env[`${id.toUpperCase()}_BASE_URL`] // للاختبار المحلي
  const base = (override || p.base).replace('{account}', env[p.account] ?? '')
  return { p, model, base, key: env[p.key], rerankUrl: override ? `${override}/rerank` : p.rerankUrl }
}

const isText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max

async function chat(b, env, signal) {
  const { p, model, base, key } = pick(b.provider, 'chat', env)
  const imgs = (m) => m.images ?? []
  const ok = Array.isArray(b.messages) && b.messages.length > 0 && b.messages.length <= 40 && b.messages.every((m) => ['system', 'user', 'assistant'].includes(m?.role) && isText(m.content, 120_000) && Array.isArray(imgs(m)) && imgs(m).every((u) => typeof u === 'string' && u.length <= 1_500_000 && IMAGE.test(u)))
  const total = ok ? b.messages.reduce((n, m) => n + imgs(m).length, 0) : 0
  if (!ok || total > MAX_IMAGES || (total && !p.vision)) throw new HttpError(400, 'bad_request')
  const res = await upstream(`${base}/chat/completions`, key, {
    model,
    stream: true,
    temperature: 0.2,
    max_tokens: Math.min(Number(b.maxTokens) || 4000, 8000),
    // الصيغة المعيارية للصور في واجهات OpenAI المتوافقة
    messages: b.messages.map((m) => ({ role: m.role, content: imgs(m).length ? [{ type: 'text', text: m.content }, ...imgs(m).map((url) => ({ type: 'image_url', image_url: { url } }))] : m.content })),
  }, signal)
  return new Response(res.body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-rafeeq-model': encodeURIComponent(model) } })
}

async function embed(b, env, signal) {
  const { p, model, base, key } = pick(b.provider, 'embed', env)
  if (!Array.isArray(b.texts) || !b.texts.length || b.texts.length > p.embedBatch || !b.texts.every((t) => isText(t, 8000))) throw new HttpError(400, 'bad_request')
  const res = await upstream(`${base}/embeddings`, key, { model, input: b.texts, ...(p.dims ? { dimensions: p.dims } : {}) }, signal)
  const data = await res.json().catch(() => null)
  const vectors = data?.data?.map((d) => d.embedding)
  if (vectors?.length !== b.texts.length || !vectors.every((v) => Array.isArray(v) && v.length === vectors[0].length)) throw new HttpError(502, 'server')
  return Response.json({ model: `${b.provider}:${model}:${vectors[0].length}`, vectors })
}

async function rerank(b, env, signal) {
  const { model, rerankUrl, key } = pick(b.provider, 'rerank', env)
  if (!isText(b.query, 4000) || !Array.isArray(b.docs) || !b.docs.length || b.docs.length > 50 || !b.docs.every((t) => isText(t, 8000))) throw new HttpError(400, 'bad_request')
  const res = await upstream(rerankUrl, key, { model, query: b.query, documents: b.docs, top_n: b.docs.length }, signal)
  const data = await res.json().catch(() => null)
  if (!Array.isArray(data?.results)) throw new HttpError(502, 'server')
  return Response.json({ order: data.results.map((r) => r.index) })
}

const status = (env) =>
  Response.json({
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, name: p.name, note: p.note, configured: isConfigured(id, env), embedBatch: p.embedBatch,
      models: { ...Object.fromEntries(['chat', 'embed', 'rerank'].filter((t) => p[t]).map((t) => [t, modelOf(id, t, env)])), ...(p.vision ? { vision: modelOf(id, 'chat', env) } : {}) },
    })),
  })

const ROUTES = { '/chat': chat, '/embed': embed, '/rerank': rerank }

async function handle(request, env) {
  // بلا رمز وصول يصبح الوسيط مفتوحاً لأي شخص، لذلك يرفض العمل
  if (!env.ACCESS_CODE) throw new HttpError(503, 'worker_setup')
  const code = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  if (!(await same(decodeURIComponent(code), env.ACCESS_CODE))) throw new HttpError(401, 'access')
  const path = new URL(request.url).pathname
  if (request.method === 'GET' && path === '/status') return status(env)
  const route = request.method === 'POST' && ROUTES[path]
  if (!route) throw new HttpError(404, 'not_found')
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new HttpError(413, 'too_large')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large')
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_request')
  }
  return route(body ?? {}, env, request.signal)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)
    const cors = allowed
      ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST', 'access-control-expose-headers': 'x-rafeeq-model', 'access-control-max-age': '86400', vary: 'origin' }
      : { vary: 'origin' }
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors })
    let res
    try {
      res = await handle(request, env)
    } catch (e) {
      res = e instanceof HttpError ? Response.json(e.body, { status: e.status }) : Response.json({ code: 'server' }, { status: 500 })
    }
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    return out
  },
}
