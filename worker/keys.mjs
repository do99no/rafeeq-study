/**
 * المجموعة المشتركة لمفاتيح الذكاء الاصطناعي.
 *
 * - المفاتيح من مصدرين: أسرار الخادم (GEMINI_API_KEY_2 …) أو مضافة من لوحة المسؤول ومشفرة في D1
 *   (AES-256-GCM بمفتاح مشتق من KEYS_SECRET). فك التشفير هنا في الخادم فقط، ولا يخرج مفتاح في أي استجابة.
 * - «المجموعة» (محمد/أمنة) للتنظيم ومعرفة المصدر فقط؛ كل المفاتيح متاحة لكل المستخدمين المصرح لهم.
 * - «المشروع» هو وحدة الحصة عند المزود (مشروع Google أو حساب Groq …). مفاتيح المشروع الواحد حصة واحدة.
 * - لا التفاف على الحدود: عند نفاد حصة المشروع أو حد الدقيقة يُنتقل إلى مزود آخر، لا إلى مشروع آخر للمزود نفسه.
 *   المشروع البديل يُستخدم فقط إذا تعطلت مفاتيح المشروع الأساسي نفسها (مفتاح غير صالح أو ملغى).
 */
import { all, db, one, run } from './db.mjs'
import { b64, HttpError, unb64 } from './http.mjs'
import { PROVIDERS, envKeys } from './providers.mjs'
import { upstream } from './upstream.mjs'


const MAX_ATTEMPTS = 4
/** حدود معروفة من الوثائق الرسمية؛ ما لا يُعرف رقمه يُعرض «غير متاح» */
const KNOWN = { openrouter: { rpd: 50 }, groq: { rpd: 1000 } }

// ===== التشفير =====
async function aesKey(env) {
  if (!env.KEYS_SECRET || env.KEYS_SECRET.length < 32) throw new HttpError(503, 'keys_secret')
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KEYS_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('rafeeq-ai-keys'), info: new TextEncoder().encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function seal(secret, id, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  // المعرّف بيانات مرافقة: لا يصلح المفتاح المشفر إن نُقل إلى سجل آخر
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await aesKey(env), new TextEncoder().encode(secret))
  return `v1.${b64(iv)}.${b64(ct)}`
}
export async function open(enc, id, env) {
  const [v, iv, ct] = enc.split('.')
  if (v !== 'v1') throw new Error('format')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(id) }, await aesKey(env), unb64(ct)))
}
const last4 = (s) => s.slice(-4)

// ===== السجل =====
let synced = new WeakMap()
/** يسجّل مفاتيح الأسرار في الجدول (دون قيمها) ويعلّم ما أُزيل منها */
export async function syncEnvKeys(DB, env) {
  const t = synced.get(env)
  if (t && Date.now() - t < 60_000) return
  synced.set(env, Date.now())
  const present = []
  const now = Date.now()
  for (const id of Object.keys(PROVIDERS))
    for (const k of envKeys(id, env)) {
      const kid = `env:${k.name}`
      present.push(kid)
      await run(DB, 'INSERT INTO ai_keys (id, provider, label, source, env_name, last4, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last4 = excluded.last4, status = CASE WHEN ai_keys.status = \'missing\' THEN \'unknown\' ELSE ai_keys.status END', kid, id, k.name, 'env', k.name, last4(k.value), now)
    }
  const rows = await all(DB, "SELECT id FROM ai_keys WHERE source = 'env'")
  for (const r of rows) if (!present.includes(r.id)) await run(DB, "UPDATE ai_keys SET status = 'missing' WHERE id = ?", r.id)
}

async function secretOf(row, env) {
  if (row.source === 'env') return env[row.env_name] ?? null
  return row.enc ? open(row.enc, row.id, env) : null
}

/**
 * المزودون المعتمدون: من لوحة المسؤول، أو من سطر واحد في أسرار الخادم APPROVED_PROVIDERS=gemini,openrouter
 * يكتبه صاحب المشروع بعد قبول شروطها. في الحالتين: المتحقق من مجانيته فقط (المحظور وغير المتحقق لا يُعتمد أبداً).
 */
export async function approvedProviders(DB, env = {}) {
  const rows = await all(DB, 'SELECT id, approved FROM ai_providers')
  const fromEnv = String(env.APPROVED_PROVIDERS ?? '').split(',').map((s) => s.trim().toLowerCase())
  // إيقاف المزود من اللوحة يغلب سطر الأسرار
  const off = (id) => rows.some((r) => r.id === id && !r.approved)
  return Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].free?.status === 'verified' && (rows.some((r) => r.id === id && r.approved) || (fromEnv.includes(id) && !off(id))))
}

/** حالة حصة مشروع: متاح، قريب من الحد، مستنفد، غير معروف */
export async function quotaState(DB, provider, project) {
  const q = await one(DB, 'SELECT cool_until, reason FROM ai_quota WHERE provider = ? AND project = ?', provider, project)
  if (q && q.cool_until > Date.now()) return { state: 'exhausted', until: q.cool_until, reason: q.reason }
  const lim = KNOWN[provider]?.rpd
  if (!lim) return { state: 'unknown' }
  const used = (await one(DB, 'SELECT COALESCE(SUM(requests), 0) AS n FROM ai_usage WHERE provider = ? AND project = ? AND day = ?', provider, project, utcDay()))?.n ?? 0
  return { state: used >= lim ? 'exhausted' : used >= lim * 0.8 ? 'near' : 'available', used, limit: lim }
}
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

/** موعد تصفير الحصة اليومية لدى المزود */
function nextReset(provider) {
  const now = new Date()
  const utcMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  if (PROVIDERS[provider].free?.reset !== 'pacific-midnight') return utcMid
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24
  const m = Number(parts.find((p) => p.type === 'minute').value)
  return now.getTime() + ((24 - h) * 60 - m) * 60_000
}

/**
 * يختار مفتاحاً للمزود: المشروع الأساسي (أول مشروع فيه مفتاح سليم)، ثم الأقدم استخداماً داخله.
 * إذا كانت حصة المشروع الأساسي مستنفدة أو في مهلة حد الدقيقة: لا مفتاح (ينتقل الطلب إلى مزود آخر).
 */
export async function pickKey(DB, provider, exclude = []) {
  const keys = await all(DB, "SELECT * FROM ai_keys WHERE provider = ? AND enabled = 1 AND status NOT IN ('auth', 'missing') ORDER BY project, created", provider)
  const usable = keys.filter((k) => !exclude.includes(k.id))
  if (!usable.length) return { key: null, why: keys.length ? 'keys_failed' : 'no_keys' }
  const primary = usable[0].project
  const q = await quotaState(DB, provider, primary)
  if (q.state === 'exhausted') return { key: null, why: 'quota', until: q.until }
  const inProject = usable.filter((k) => k.project === primary).sort((a, b) => (a.last_used ?? 0) - (b.last_used ?? 0))
  return { key: inProject[0], quota: q }
}

async function logUsage(DB, k, model, user, kind, ok, tin = 0, tout = 0) {
  await run(DB, 'INSERT INTO ai_usage (day, key_id, provider, project, model, user_id, kind, requests, ok, errors, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(day, key_id, model, user_id, kind) DO UPDATE SET requests = requests + 1, ok = ok + excluded.ok, errors = errors + excluded.errors, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out', utcDay(), k.id, k.provider, k.project, model, user, kind, ok ? 1 : 0, ok ? 0 : 1, tin, tout)
}

/** يطبّق نتيجة الخطأ على المفتاح أو المشروع، ويعيد هل يُجرَّب مفتاح آخر من المزود نفسه */
async function onError(DB, k, e, model, user) {
  const code = e instanceof HttpError ? e.body.code : 'network'
  const now = Date.now()
  await run(DB, 'INSERT INTO ai_errors (at, key_id, provider, project, model, code, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', now, k.id, k.provider, k.project, model, code, e.body?.upstream ?? null, user)
  await run(DB, 'DELETE FROM ai_errors WHERE id <= (SELECT MAX(id) - 1000 FROM ai_errors)')
  // الازدحام والتأخر من المزود لا من المفتاح: لا تتغير حالة المفتاح
  await run(DB, "UPDATE ai_keys SET last_error = ?, last_error_at = ?, status = CASE WHEN ? IN ('auth', 'quota', 'rate', 'bad_request') THEN ? ELSE status END WHERE id = ?", code, now, code, code === 'bad_request' ? 'error' : code, k.id)
  const cool = (until, reason) => run(DB, 'INSERT INTO ai_quota (provider, project, cool_until, reason) VALUES (?, ?, ?, ?) ON CONFLICT(provider, project) DO UPDATE SET cool_until = excluded.cool_until, reason = excluded.reason', k.provider, k.project, until, reason)
  // الحصة وحد الدقيقة يخصان المشروع كله: لا تبديل داخل المزود
  if (code === 'quota') await cool(Math.max(nextReset(k.provider), now + 60_000), 'quota')
  if (code === 'rate') await cool(now + Math.min(Number(e.body?.retryAfter) || 60, 600) * 1000, 'rate')
  // مفتاح معطوب (غير صالح أو ملغى) أو خطأ مؤقت: يُجرَّب مفتاح آخر مرة واحدة
  return { code, sameProvider: code === 'auth' || code === 'server' || code === 'timeout' || code === 'network', stop: code === 'bad_request' || code === 'too_large' }
}

/** يقرأ عدد الرموز من آخر البث إن أرسله المزود، دون تأخير الطالب */
function meterStream(body, onDone) {
  let tail = ''
  const dec = new TextDecoder()
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, c) {
        tail = (tail + dec.decode(chunk, { stream: true })).slice(-4000)
        c.enqueue(chunk)
      },
      async flush() {
        const m = tail.match(/"usage"\s*:\s*\{[^}]*\}/g)?.at(-1)
        let tin = 0, tout = 0
        if (m) {
          tin = Number(m.match(/"prompt_tokens"\s*:\s*(\d+)/)?.[1] ?? 0)
          tout = Number(m.match(/"completion_tokens"\s*:\s*(\d+)/)?.[1] ?? 0)
        }
        await onDone(tin, tout).catch(() => {})
      },
    }),
  )
}

const baseOf = (provider, k, env) => {
  const p = PROVIDERS[provider]
  const override = env[`${provider.toUpperCase()}_BASE_URL`] // للاختبار المحلي
  const account = provider === 'cloudflare' ? (k.source === 'env' ? env[p.account] : k.project) : ''
  return { base: (override || p.base).replace('{account}', account ?? ''), rerankUrl: override ? `${override}/rerank` : p.rerankUrl }
}

/** نماذج مزدحمة مؤقتاً (في هذه النسخة من الخادم) */
const busy = new Map()
/** النماذج المجانية المسموح بها بالترتيب: الرئيسية ثم الأخف، وما يقرأ الصور فقط عند الحاجة */
function modelsFor(provider, needVision) {
  const p = PROVIDERS[provider]
  return (p.models ?? []).filter((m) => (!needVision || m.vision) && (!p.freeOnly || p.freeOnly.test(m.id))).sort((x, y) => (x.tier === 'main' ? 0 : 1) - (y.tier === 'main' ? 0 : 1))
}
/** النموذج المجاني المناسب: يقرأ الصور إن لزم، وإلا الرئيسي */
function modelFor(provider, needVision) {
  const list = PROVIDERS[provider].models ?? []
  const m = list.find((x) => x.tier === 'main' && (!needVision || x.vision)) ?? list.find((x) => !needVision || x.vision)
  if (!m) return null
  // حاجز أخير ضد النماذج المدفوعة
  if (PROVIDERS[provider].freeOnly && !PROVIDERS[provider].freeOnly.test(m.id)) return null
  return m
}

/**
 * طلب محادثة عبر المجموعة المشتركة: مزود معتمد → مفتاح من مشروعه الأساسي → عند الفشل حسب نوعه.
 * لا تتجاوز المحاولات MAX_ATTEMPTS، ولا يُستخدم مزود غير معتمد أو نموذج غير مجاني.
 */
export async function poolChat(b, env, ctx, user, signal, buildBody) {
  const DB = await db(env)
  await syncEnvKeys(DB, env)
  const approved = await approvedProviders(DB, env)
  const hasImages = b.messages.some((m) => m.images?.length)
  // من يقرأ الصور أولاً عند وجودها
  const order = hasImages ? [...approved.filter((id) => modelFor(id, true)), ...approved.filter((id) => !modelFor(id, true))] : approved
  // لا مزود معتمد: الخدمة غير مفعّلة (لا يُعرض كأنه نفاد حصة)
  if (!order.length) throw new HttpError(400, 'not_configured')
  let attempts = 0
  let soonest = 0
  for (const provider of order) {
    const vision = hasImages && !!modelFor(provider, true)
    // النماذج المجانية للمزود بالترتيب (الرئيسي أولاً)؛ المزدحم مؤقتاً يُتخطى دقيقة
    const models = modelsFor(provider, vision).filter((m) => (busy.get(`${provider}/${m.id}`) ?? 0) < Date.now())
    if (!models.length) continue
    let mi = 0
    const tried = []
    while (attempts < MAX_ATTEMPTS && mi < models.length) {
      const model = models[mi]
      const pick = await pickKey(DB, provider, tried)
      if (!pick.key) {
        if (pick.until) soonest = soonest ? Math.min(soonest, pick.until) : pick.until
        break
      }
      const k = pick.key
      tried.push(k.id)
      attempts++
      await run(DB, 'UPDATE ai_keys SET last_used = ? WHERE id = ?', Date.now(), k.id)
      try {
        const secret = await secretOf(k, env)
        if (!secret) throw new HttpError(502, 'auth')
        const { base } = baseOf(provider, k, env)
        const res = await upstream(`${base}/chat/completions`, secret, buildBody(model.id, vision, PROVIDERS[provider].extra), signal)
        await run(DB, "UPDATE ai_keys SET status = 'ok', last_ok = ? WHERE id = ?", Date.now(), k.id)
        const done = (tin, tout) => logUsage(DB, k, model.id, user, 'chat', true, tin, tout)
        // تسجيل الرموز بعد انتهاء البث دون تأخير الطالب
        return { provider, model: model.id, vision, stream: meterStream(res.body, (x, y) => { const p = done(x, y); ctx?.waitUntil?.(p); return p }) }
      } catch (e) {
        if (signal?.aborted) throw e
        await logUsage(DB, k, model.id, user, 'chat', false)
        const r = await onError(DB, k, e, model.id, user)
        if (r.stop) throw e
        // مفتاح معطوب: مفتاح آخر بالنموذج نفسه
        if (r.code === 'auth') continue
        // ازدحام أو تأخر أو نموذج غير متاح: النموذج المجاني التالي للمزود نفسه (ليس التفافاً على حصة)
        if (r.code === 'server' || r.code === 'timeout' || r.code === 'model' || r.code === 'network') {
          busy.set(`${provider}/${model.id}`, Date.now() + 60_000)
          mi++
          continue
        }
        // الحصة أو حد الدقيقة: مزود آخر
        break
      }
    }
    if (attempts >= MAX_ATTEMPTS) break
  }
  throw new HttpError(503, 'quota', { retryAfter: soonest ? Math.ceil((soonest - Date.now()) / 1000) : 300, pool: true })
}

/** التضمين عبر المجموعة: نموذج التضمين ثابت لكل مزود كي تبقى المتجهات متوافقة */
export async function poolEmbed(b, env, user, signal) {
  const DB = await db(env)
  await syncEnvKeys(DB, env)
  const provider = (await approvedProviders(DB, env)).find((id) => PROVIDERS[id].embedModels?.length)
  if (!provider) throw new HttpError(400, 'not_configured')
  const p = PROVIDERS[provider]
  const model = p.embedModels[0]
  const tried = []
  for (let i = 0; i < 2; i++) {
    const pick = await pickKey(DB, provider, tried)
    if (!pick.key) throw new HttpError(503, 'quota', { retryAfter: pick.until ? Math.ceil((pick.until - Date.now()) / 1000) : 300 })
    const k = pick.key
    tried.push(k.id)
    await run(DB, 'UPDATE ai_keys SET last_used = ? WHERE id = ?', Date.now(), k.id)
    try {
      const { base } = baseOf(provider, k, env)
      const res = await upstream(`${base}/embeddings`, await secretOf(k, env), { model, input: b.texts, ...(p.dims ? { dimensions: p.dims } : {}) }, signal)
      const data = await res.json().catch(() => null)
      const vectors = data?.data?.map((d) => d.embedding)
      if (vectors?.length !== b.texts.length) throw new HttpError(502, 'server')
      await run(DB, "UPDATE ai_keys SET status = 'ok', last_ok = ? WHERE id = ?", Date.now(), k.id)
      await logUsage(DB, k, model, user, 'embed', true, data?.usage?.prompt_tokens ?? 0, 0)
      return { model: `auto:${provider}/${model}:${vectors[0].length}`, vectors }
    } catch (e) {
      await logUsage(DB, k, model, user, 'embed', false)
      const r = await onError(DB, k, e, model, user)
      if (!r.sameProvider) throw e
    }
  }
  throw new HttpError(503, 'quota', { retryAfter: 300 })
}

/** هل المجموعة المشتركة فعالة (قاعدة بيانات + مزود معتمد واحد على الأقل) */
export async function poolInfo(env) {
  const DB = await db(env)
  if (!DB) return null
  await syncEnvKeys(DB, env)
  const ids = await approvedProviders(DB, env)
  const embedProvider = ids.find((id) => PROVIDERS[id].embedModels?.length)
  return {
    active: ids.length > 0,
    vision: ids.some((id) => modelFor(id, true)),
    embed: embedProvider ? `${embedProvider}/${PROVIDERS[embedProvider].embedModels[0]}` : null,
  }
}

/** اختبار اتصال مفتاح واحد (يستهلك طلباً حقيقياً واحداً صغيراً): للمسؤول وبموافقته */
export async function testKey(DB, env, id) {
  const k = await one(DB, 'SELECT * FROM ai_keys WHERE id = ?', id)
  if (!k) throw new HttpError(404, 'not_found')
  if (!(await approvedProviders(DB, env)).includes(k.provider)) throw new HttpError(400, 'not_approved')
  const model = modelFor(k.provider, false)
  if (!model) throw new HttpError(400, 'no_free_model')
  const t = Date.now()
  try {
    const res = await upstream(`${baseOf(k.provider, k, env).base}/chat/completions`, await secretOf(k, env), { model: model.id, stream: false, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with one word: ok' }], ...(PROVIDERS[k.provider].extra ?? {}) })
    await res.text()
    await run(DB, "UPDATE ai_keys SET status = 'ok', last_ok = ?, last_used = ? WHERE id = ?", Date.now(), Date.now(), id)
    await logUsage(DB, k, model.id, 'admin-test', 'test', true)
    return { ok: true, ms: Date.now() - t, model: model.id }
  } catch (e) {
    await logUsage(DB, k, model.id, 'admin-test', 'test', false)
    const r = await onError(DB, k, e, model.id, 'admin-test')
    return { ok: false, code: r.code, ms: Date.now() - t }
  }
}
