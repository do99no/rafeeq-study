/**
 * إدارة المجموعة المشتركة من لوحة المسؤول. لا تخرج قيمة أي مفتاح في أي استجابة: الاسم وآخر 4 أحرف فقط.
 */
import { requireUser, STUDENTS } from './auth.mjs'
import { all, db, one, run } from './db.mjs'
import { HttpError, isText, randomToken } from './http.mjs'
import { approvedProviders, quotaState, seal, syncEnvKeys, testKey } from './keys.mjs'
import { PROVIDERS } from './providers.mjs'

const OWNERS = new Set(['mohamed', 'amna', 'family', 'unassigned'])
const DAY = 86400_000
const utcDay = (t) => new Date(t).toISOString().slice(0, 10)
const KEY_SHAPE = /^[A-Za-z0-9._:\-]{20,400}$/

async function admin(request, env) {
  await requireUser(request, env, 'admin')
  const DB = await db(env)
  if (!DB) throw new HttpError(503, 'no_db')
  await syncEnvKeys(DB, env)
  return DB
}

const publicKey = (k) => ({
  id: k.id, provider: k.provider, label: k.label, owner: k.owner, project: k.project, source: k.source,
  hint: `…${k.last4}`, enabled: !!k.enabled, status: k.status, lastOk: k.last_ok, lastUsed: k.last_used, lastError: k.last_error, lastErrorAt: k.last_error_at, created: k.created,
})

/** GET /admin/ai: المزودون، والمفاتيح (مخفية)، والحصص، والاستهلاك، والأخطاء */
export async function overview(request, env) {
  const DB = await admin(request, env)
  const keys = await all(DB, 'SELECT * FROM ai_keys ORDER BY provider, project, created')
  const approvals = await all(DB, 'SELECT * FROM ai_providers')
  const approved = await approvedProviders(DB)
  const since = (d) => utcDay(Date.now() - d * DAY)
  const usage = await all(DB, 'SELECT * FROM ai_usage WHERE day >= ?', since(30))
  const sum = (rows) => rows.reduce((a, r) => ({ requests: a.requests + r.requests, ok: a.ok + r.ok, errors: a.errors + r.errors, tokensIn: a.tokensIn + r.tokens_in, tokensOut: a.tokensOut + r.tokens_out }), { requests: 0, ok: 0, errors: 0, tokensIn: 0, tokensOut: 0 })
  const by = (field, rows) => Object.entries(rows.reduce((m, r) => ((m[r[field]] ??= []).push(r), m), {})).map(([name, rs]) => ({ name, ...sum(rs) })).sort((a, b) => b.requests - a.requests)
  const today = usage.filter((r) => r.day === utcDay(Date.now()))
  const week = usage.filter((r) => r.day >= since(6))
  const projects = []
  for (const p of [...new Set(keys.map((k) => `${k.provider}\u0000${k.project}`))]) {
    const [provider, project] = p.split('\u0000')
    projects.push({ provider, project, keys: keys.filter((k) => k.provider === provider && k.project === project).length, quota: await quotaState(DB, provider, project), today: sum(today.filter((r) => r.provider === provider && r.project === project)) })
  }
  return {
    providers: Object.entries(PROVIDERS).map(([id, p]) => {
      const a = approvals.find((x) => x.id === id)
      return { id, name: p.name, free: p.free, confirm: p.confirm ?? null, models: (p.models ?? []).map((m) => ({ id: m.id, vision: m.vision, tier: m.tier, arabic: m.arabic })), approved: approved.includes(id), approvedAt: a?.approved_at ?? null, keys: keys.filter((k) => k.provider === id).length }
    }),
    keys: keys.map(publicKey),
    projects,
    usage: {
      today: sum(today), week: sum(week), month: sum(usage),
      byProvider: by('provider', week), byKey: by('key_id', week), byProject: by('project', week), byModel: by('model', week),
      // إحصاء فقط: المفاتيح مشتركة، وليست حصة مخصصة لأحد
      byUser: by('user_id', week).map((u) => ({ ...u, label: STUDENTS.find((s) => s.id === u.name)?.name ?? (u.name === 'admin' ? 'المسؤول' : u.name === 'admin-test' ? 'اختبارات المسؤول' : u.name === 'access' ? 'رمز الوصول (دون حساب)' : u.name) })),
    },
    errors: await all(DB, 'SELECT at, key_id, provider, project, model, code, status, user_id FROM ai_errors ORDER BY id DESC LIMIT 100'),
    canAdd: !!env.KEYS_SECRET && env.KEYS_SECRET.length >= 32,
  }
}

/** POST /admin/ai/keys: إضافة مفتاح مشفراً. القيمة لا تُعاد ولا تُسجَّل */
export async function addKey(request, env, b) {
  const DB = await admin(request, env)
  if (!PROVIDERS[b.provider]) throw new HttpError(400, 'bad_request')
  if (!isText(b.label, 60) || !OWNERS.has(b.owner) || typeof b.project !== 'string' || b.project.length > 80) throw new HttpError(400, 'bad_request')
  if (typeof b.key !== 'string' || !KEY_SHAPE.test(b.key.trim())) throw new HttpError(400, 'bad_key')
  if (b.provider === 'cloudflare' && !/^[a-f0-9]{32}$/.test(b.project)) throw new HttpError(400, 'cloudflare_account')
  const id = `db:${randomToken(9)}`
  const secret = b.key.trim()
  const enc = await seal(secret, id, env)
  await run(DB, 'INSERT INTO ai_keys (id, provider, label, owner, project, source, enc, last4, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, b.provider, b.label.trim(), b.owner, b.project.trim(), 'db', enc, secret.slice(-4), Date.now())
  return { key: publicKey(await one(DB, 'SELECT * FROM ai_keys WHERE id = ?', id)) }
}

/** PATCH /admin/ai/keys/<id>: تفعيل، تعطيل، الاسم، المجموعة، المشروع */
export async function patchKey(request, env, id, b) {
  const DB = await admin(request, env)
  const k = await one(DB, 'SELECT * FROM ai_keys WHERE id = ?', id)
  if (!k) throw new HttpError(404, 'not_found')
  const set = []
  const args = []
  if (typeof b.enabled === 'boolean') set.push('enabled = ?') && args.push(b.enabled ? 1 : 0)
  if (isText(b.label, 60)) set.push('label = ?') && args.push(b.label.trim())
  if (OWNERS.has(b.owner)) set.push('owner = ?') && args.push(b.owner)
  if (typeof b.project === 'string' && b.project.length <= 80 && k.provider !== 'cloudflare') set.push('project = ?') && args.push(b.project.trim())
  // إعادة التفعيل بعد خطأ صلاحية: تُعاد الحالة لتُختبر من جديد
  if (b.enabled === true && k.status === 'auth') set.push("status = 'unknown'")
  if (!set.length) throw new HttpError(400, 'bad_request')
  await run(DB, `UPDATE ai_keys SET ${set.join(', ')} WHERE id = ?`, ...args, id)
  return { key: publicKey(await one(DB, 'SELECT * FROM ai_keys WHERE id = ?', id)) }
}

/** DELETE: المفاتيح المضافة من اللوحة فقط. مفاتيح الأسرار تُزال من أسرار الخادم نفسها */
export async function deleteKey(request, env, id) {
  const DB = await admin(request, env)
  const k = await one(DB, 'SELECT source FROM ai_keys WHERE id = ?', id)
  if (!k) throw new HttpError(404, 'not_found')
  if (k.source === 'env') throw new HttpError(400, 'env_key')
  await run(DB, 'DELETE FROM ai_keys WHERE id = ?', id)
  return { ok: true }
}

/** POST /admin/ai/keys/<id>/test: طلب حقيقي واحد صغير. يتطلب مزوداً معتمداً */
export async function test(request, env, id) {
  const DB = await admin(request, env)
  return testKey(DB, env, id)
}

/** PUT /admin/ai/providers/<id>: اعتماد مزود بعد تأكيد شروطه. المزود غير المتحقق منه أو المحظور لا يُعتمد */
export async function approve(request, env, id, b) {
  const DB = await admin(request, env)
  const p = PROVIDERS[id]
  if (!p) throw new HttpError(404, 'not_found')
  if (b.approved) {
    if (p.free?.status !== 'verified') throw new HttpError(400, 'not_verified')
    const need = Object.keys(p.confirm ?? {})
    if (!need.every((k) => b.confirm?.[k] === true)) throw new HttpError(400, 'confirm_required', { need })
  }
  await run(DB, 'INSERT INTO ai_providers (id, approved, approved_at, confirm) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET approved = excluded.approved, approved_at = excluded.approved_at, confirm = excluded.confirm', id, b.approved ? 1 : 0, b.approved ? Date.now() : null, JSON.stringify(b.approved ? b.confirm : {}))
  return { ok: true, approved: !!b.approved }
}
