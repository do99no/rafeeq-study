/**
 * خادم رفيق: يحمي مفاتيح الذكاء الاصطناعي ويمرر طلباته (لا يخزن أسئلة الطالب إليه)،
 * ويدير حسابات الطالبين وبياناتهما ووقت الدراسة ولوحة المسؤول عند ربط قاعدة D1.
 */
import * as admin from './admin.mjs'
import * as auth from './auth.mjs'
import * as data from './data.mjs'
import { HttpError, isText, same } from './http.mjs'
import { PROVIDERS, isConfigured, modelOf } from './providers.mjs'
import * as track from './track.mjs'

// صور الصفحات تكبر الطلب: حتى 4 صور JPEG
const MAX_BODY = 6_000_000
const MAX_IMAGES = 4
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
const FIRST_BYTE_MS = 40_000


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

async function jsonBody(request, max = 64_000) {
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'too_large')
  const text = await request.text()
  if (text.length > max) throw new HttpError(413, 'too_large')
  try {
    return JSON.parse(text) ?? {}
  } catch {
    throw new HttpError(400, 'bad_request')
  }
}

/** مسارات الحسابات والبيانات والمتابعة: كل منها يتحقق من الجلسة ودورها بنفسه */
async function accounts(request, env, url) {
  const p = url.pathname
  const m = request.method
  const J = (x) => Response.json(x, { headers: { 'cache-control': 'no-store' } })
  if (m === 'GET' && p === '/auth/status') return J(await auth.status(env))
  if (m === 'POST' && p === '/auth/setup') return J(await auth.setup(await jsonBody(request), env))
  if (m === 'POST' && p === '/auth/login') return J(await auth.login(await jsonBody(request), env, request))
  if (m === 'POST' && p === '/auth/logout') return J(await auth.logout(request, env))
  if (m === 'GET' && p === '/auth/me') {
    const u = await auth.requireUser(request, env)
    return J({ user: { id: u.id, role: u.role, name: u.name }, library: env.LIBRARY_CODE ?? null })
  }
  if (m === 'POST' && p === '/auth/password') return J(await auth.changeOwn(await jsonBody(request), env, request))
  if (m === 'GET' && p === '/data') return J(await data.getOwn(request, env))
  let k = p.match(/^\/data\/([^/]+)$/)?.[1]
  if (k && m === 'PUT') return J(await data.putOwn(request, env, decodeURIComponent(k)))
  if (k && m === 'DELETE') return J(await data.deleteOwn(request, env, decodeURIComponent(k)))
  if (m === 'POST' && p === '/track/start') return J(await track.start(request, env, await jsonBody(request)))
  if (m === 'POST' && p === '/track/beat') return J(await track.beat(request, env, await jsonBody(request)))
  if (m === 'POST' && p === '/track/end') return J(await track.end(request, env, await jsonBody(request)))
  if (m === 'POST' && p === '/track/events') return J(await track.events(request, env, await jsonBody(request, 200_000)))
  if (m === 'GET' && p === '/plan') return J(await track.ownPlan(request, env))
  if (m === 'GET' && p === '/admin/overview') return J(await admin.overview(request, env))
  if (m === 'GET' && p === '/admin/events') return J(await admin.timeline(request, env, url))
  if (m === 'POST' && p === '/admin/password') return J(await auth.adminSetPassword(await jsonBody(request), env, request))
  if (m === 'POST' && p === '/admin/restore') return J(await data.restore(request, env, await jsonBody(request)))
  k = p.match(/^\/admin\/(student|data|plan|backups)\/([a-z]+)$/)?.slice(1)
  if (k && m === 'GET' && k[0] === 'student') return J(await admin.student(request, env, k[1]))
  if (k && m === 'GET' && k[0] === 'data') return J(await admin.data(request, env, k[1]))
  if (k && m === 'GET' && k[0] === 'backups') return J(await data.listBackups(request, env, k[1]))
  if (k && m === 'PUT' && k[0] === 'plan') return J(await admin.putPlan(request, env, k[1], await jsonBody(request)))
  return null
}

async function handle(request, env) {
  const url = new URL(request.url)
  if (/^\/(auth|data|track|plan|admin)(\/|$)/.test(url.pathname)) {
    const res = await accounts(request, env, url)
    if (res) return res
    throw new HttpError(404, 'not_found')
  }
  // الذكاء الاصطناعي: جلسة طالب أو مسؤول، أو رمز الوصول المشترك (للتشغيل دون حسابات)
  if (auth.hasSessionHeader(request)) await auth.requireUser(request, env)
  else {
    // بلا رمز وصول يصبح الوسيط مفتوحاً لأي شخص، لذلك يرفض العمل
    if (!env.ACCESS_CODE) throw new HttpError(503, 'worker_setup')
    const code = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
    if (!(await same(decodeURIComponent(code), env.ACCESS_CODE))) throw new HttpError(401, 'access')
  }
  const path = url.pathname
  if (request.method === 'GET' && path === '/status') return status(env)
  const route = request.method === 'POST' && ROUTES[path]
  if (!route) throw new HttpError(404, 'not_found')
  return route(await jsonBody(request, MAX_BODY), env, request.signal)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)
    const cors = allowed
      ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE', 'access-control-expose-headers': 'x-rafeeq-model', 'access-control-max-age': '86400', vary: 'origin' }
      : { vary: 'origin' }
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors })
    let res
    try {
      res = await handle(request, env)
    } catch (e) {
      // لا تُسجَّل أجسام الطلبات (قد تحتوي كلمات مرور)
      res = e instanceof HttpError ? Response.json(e.body, { status: e.status }) : Response.json({ code: 'server' }, { status: 500 })
    }
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    return out
  },
  /** نسخ احتياطي يومي لبيانات الطالبين (Cron في wrangler.toml) */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(data.dailyBackup(env))
  },
}
