/**
 * خادم رفيق: يحمي مفاتيح الذكاء الاصطناعي ويمرر طلباته (لا يخزن أسئلة الطالب إليه)،
 * ويدير حسابات الطالبين وبياناتهما ووقت الدراسة ولوحة المسؤول عند ربط قاعدة D1.
 */
import * as admin from './admin.mjs'
import * as auth from './auth.mjs'
import * as data from './data.mjs'
import { HttpError, isText, same } from './http.mjs'
import { PROVIDERS, isConfigured, modelOf } from './providers.mjs'
import { upstream } from './upstream.mjs'
import { poolChat, poolEmbed, poolInfo } from './keys.mjs'
import * as aiadmin from './aiadmin.mjs'
export { classify } from './upstream.mjs'
import * as track from './track.mjs'

// صور الصفحات تكبر الطلب: حتى 4 صور JPEG
const MAX_BODY = 6_000_000
const MAX_IMAGES = 4
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
function pick(id, task, env) {
  const p = Object.hasOwn(PROVIDERS, id ?? '') ? PROVIDERS[id] : null
  if (!p || !p[task]) throw new HttpError(400, 'bad_request')
  // مع قاعدة البيانات: الطلب عبر المجموعة المشتركة فقط، فلا يتجاوز أحد اعتماد المسؤول
  if (env.DB) throw new HttpError(400, 'use_pool')
  // مزود مجاني متحقق منه فقط
  if (p.free?.status !== 'verified') throw new HttpError(400, 'not_free')
  if (!isConfigured(id, env)) throw new HttpError(400, 'not_configured')
  const model = modelOf(id, task, env)
  if (p.freeOnly && !p.freeOnly.test(model)) throw new HttpError(400, 'model')
  // النموذج يجب أن يكون في قائمة النماذج المجانية، حتى لو غُيّر بمتغير بيئة
  const allowed = task === 'embed' ? (p.embedModels ?? []) : task === 'rerank' ? [p.rerank] : (p.models ?? []).map((m) => m.id)
  if (!allowed.includes(model)) throw new HttpError(400, 'model')
  const override = env[`${id.toUpperCase()}_BASE_URL`] // للاختبار المحلي
  const base = (override || p.base).replace('{account}', env[p.account] ?? '')
  return { p, model, base, key: env[p.key], rerankUrl: override ? `${override}/rerank` : p.rerankUrl }
}

const imgs = (m) => m.images ?? []
const wire = (messages) => messages.map((m) => ({ role: m.role, content: imgs(m).length ? [{ type: 'text', text: m.content }, ...imgs(m).map((url) => ({ type: 'image_url', image_url: { url } }))] : m.content }))
const SSE = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' }

async function chat(b, env, signal, ctx) {
  if (b.provider === 'auto') return pooledChat(b, env, signal, ctx)
  const { p, model, base, key } = pick(b.provider, 'chat', env)
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
  return new Response(res.body, { headers: { ...SSE, 'x-rafeeq-model': encodeURIComponent(model) } })
}

/** المجموعة المشتركة: المزود والمفتاح يختارهما الخادم وفق الاعتماد والحصة */
async function pooledChat(b, env, signal, ctx) {
  const ok = Array.isArray(b.messages) && b.messages.length > 0 && b.messages.length <= 40 && b.messages.every((m) => ['system', 'user', 'assistant'].includes(m?.role) && isText(m.content, 120_000) && Array.isArray(imgs(m)) && imgs(m).every((u) => typeof u === 'string' && u.length <= 1_500_000 && IMAGE.test(u)))
  if (!ok || b.messages.reduce((n, m) => n + imgs(m).length, 0) > MAX_IMAGES) throw new HttpError(400, 'bad_request')
  const r = await poolChat(b, env, ctx, ctx.who, signal, (model, vision, extra) => ({
    model, stream: true, temperature: 0.2, max_tokens: Math.min(Number(b.maxTokens) || 4000, 8000), ...(extra ?? {}),
    // المزود الذي لا يقرأ الصور يتلقى النص وحده
    messages: vision ? wire(b.messages) : b.messages.map((m) => ({ role: m.role, content: m.content })),
  }))
  return new Response(r.stream, { headers: { ...SSE, 'x-rafeeq-model': encodeURIComponent(r.model), 'x-rafeeq-provider': encodeURIComponent(PROVIDERS[r.provider].name), 'x-rafeeq-images': r.vision ? '1' : '0' } })
}

async function embed(b, env, signal, ctx) {
  if (b.provider === 'auto') {
    if (!Array.isArray(b.texts) || !b.texts.length || b.texts.length > 32 || !b.texts.every((t) => isText(t, 8000))) throw new HttpError(400, 'bad_request')
    return Response.json(await poolEmbed(b, env, ctx.who, signal))
  }
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

async function status(env) {
  // مع قاعدة البيانات: المجموعة المشتركة وحدها (لا وصول مباشر إلى مزود يتجاوز الاعتماد)
  const pool = await poolInfo(env)
  if (pool)
    return Response.json({
      pool: true,
      providers: [{ id: 'auto', name: 'المجموعة المشتركة', configured: pool.active, embedBatch: 32, models: { ...(pool.active ? { chat: 'auto' } : {}), ...(pool.vision ? { vision: 'auto' } : {}), ...(pool.embed ? { embed: pool.embed } : {}) } }],
    })
  return Response.json({
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, name: p.name, note: p.note, configured: isConfigured(id, env), embedBatch: p.embedBatch,
      models: { ...Object.fromEntries(['chat', 'embed', 'rerank'].filter((t) => p[t]).map((t) => [t, modelOf(id, t, env)])), ...(p.vision ? { vision: modelOf(id, 'chat', env) } : {}) },
    })),
  })
}

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
  if (m === 'GET' && p === '/admin/ai') return J(await aiadmin.overview(request, env))
  if (m === 'POST' && p === '/admin/ai/keys') return J(await aiadmin.addKey(request, env, await jsonBody(request)))
  const ak = p.match(/^\/admin\/ai\/keys\/([^/]+?)(\/test)?$/)
  if (ak && m === 'POST' && ak[2]) return J(await aiadmin.test(request, env, decodeURIComponent(ak[1])))
  if (ak && m === 'PATCH' && !ak[2]) return J(await aiadmin.patchKey(request, env, decodeURIComponent(ak[1]), await jsonBody(request)))
  if (ak && m === 'DELETE' && !ak[2]) return J(await aiadmin.deleteKey(request, env, decodeURIComponent(ak[1])))
  const ap = p.match(/^\/admin\/ai\/providers\/([a-z]+)$/)
  if (ap && m === 'PUT') return J(await aiadmin.approve(request, env, ap[1], await jsonBody(request)))
  if (m === 'POST' && p === '/admin/restore') return J(await data.restore(request, env, await jsonBody(request)))
  k = p.match(/^\/admin\/(student|data|plan|backups)\/([a-z]+)$/)?.slice(1)
  if (k && m === 'GET' && k[0] === 'student') return J(await admin.student(request, env, k[1]))
  if (k && m === 'GET' && k[0] === 'data') return J(await admin.data(request, env, k[1]))
  if (k && m === 'GET' && k[0] === 'backups') return J(await data.listBackups(request, env, k[1]))
  if (k && m === 'PUT' && k[0] === 'plan') return J(await admin.putPlan(request, env, k[1], await jsonBody(request)))
  return null
}

async function handle(request, env, ctx) {
  const url = new URL(request.url)
  if (/^\/(auth|data|track|plan|admin)(\/|$)/.test(url.pathname)) {
    const res = await accounts(request, env, url)
    if (res) return res
    throw new HttpError(404, 'not_found')
  }
  // الذكاء الاصطناعي: جلسة طالب أو مسؤول، أو رمز الوصول المشترك (للتشغيل دون حسابات)
  // من أرسل الطلب: للإحصاء فقط (المفاتيح مشتركة)
  ctx.who = 'access'
  if (auth.hasSessionHeader(request)) ctx.who = (await auth.requireUser(request, env)).id
  else {
    // بلا رمز وصول يصبح الوسيط مفتوحاً لأي شخص، لذلك يرفض العمل
    if (!env.ACCESS_CODE) throw new HttpError(503, 'worker_setup')
    const code = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
    if (!(await same(decodeURIComponent(code), env.ACCESS_CODE))) throw new HttpError(401, 'access')
  }
  const path = url.pathname
  if (request.method === 'GET' && path === '/status') return await status(env)
  const route = request.method === 'POST' && ROUTES[path]
  if (!route) throw new HttpError(404, 'not_found')
  return route(await jsonBody(request, MAX_BODY), env, request.signal, ctx)
}

export default {
  async fetch(request, env, ctx = { waitUntil() {} }) {
    const origin = request.headers.get('origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)
    const cors = allowed
      ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE', 'access-control-expose-headers': 'x-rafeeq-model,x-rafeeq-provider,x-rafeeq-images', 'access-control-max-age': '86400', vary: 'origin' }
      : { vary: 'origin' }
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors })
    let res
    try {
      res = await handle(request, env, { waitUntil: (p) => ctx.waitUntil(p), who: 'access' })
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
