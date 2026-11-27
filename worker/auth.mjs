/**
 * حسابات رفيق: مسؤول وطالبان. لا تسجيل من صفحة الدخول، وكلمات المرور يحددها المسؤول.
 *
 * التجزئة (المخطط c1): الاشتقاق المكلف في متصفح المستخدم، لا في الخادم:
 *   proof = PBKDF2-SHA256(كلمة المرور، ملح عشوائي لكل مستخدم، 600000 تكرار)   ← في المتصفح
 *   المخزَّن = HMAC-SHA256(PASSWORD_PEPPER، proof)                              ← في الخادم (ميكروثوانٍ)
 * السبب: حد المعالج في Cloudflare Workers المجانية نحو 10ms للطلب، و PBKDF2 بمئة ألف تكرار يحتاج أكثر من 100ms.
 * الحماية لا تضعف: كلمة المرور لا تصل إلى الخادم؛ تسريب القاعدة وحدها لا يكفي دون الفلفل السري؛ ومع الفلفل
 * يلزم 600000 تكرار لكل تخمين (أكثر من المخطط السابق). يبقى في الخادم: قفل الحساب بعد 5 محاولات، وحد لكل IP،
 * وملح وهمي ثابت للحساب غير الموجود كي لا يُعرف وجوده. شرط الطول (8 أحرف) تفرضه الواجهة لأن الخادم لا يرى الكلمة.
 */
import { all, db, one, run } from './db.mjs'
import { b64, HttpError, isText, randomToken, same, sha256, unb64 } from './http.mjs'

export const ITERS = 100_000
/** تكرارات المتصفح في المخطط c1 (توصية OWASP لـ PBKDF2-SHA256) */
export const CLIENT_ITERS = 600_000
const SESSION_DAYS = 14
const IDLE_DAYS = 3
const MAX_FAILS = 5
const LOCK_MIN = 15
const IP_FAILS = 20

/** الطالبان ثابتان: الهوية بالمعرّف وكلمة المرور، لا بالاسم وحده */
export const STUDENTS = [
  { id: 'mohamed', name: 'محمد' },
  { id: 'amna', name: 'أمنة' },
]

async function derive(password, salt, iters, pepper) {
  // الفلفل يدخل عبر HMAC قبل الاشتقاق، فلا تكفي قاعدة البيانات وحدها لتجربة كلمات المرور
  const hk = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const peppered = await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(password.normalize('NFC')))
  const base = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits'])
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iters }, base, 256))
}
const pepperOf = (env) => {
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 16) throw new HttpError(503, 'worker_setup')
  return env.PASSWORD_PEPPER
}
export async function hashPassword(password, env) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)))
  // يمكن خفضه بسر PBKDF2_ITERATIONS إن تجاوز الدخول حد المعالج في خطة Cloudflare المجانية (10000 على الأقل).
  // كل كلمة مرور تحفظ عدد تكراراتها، فلا تبطل الكلمات القديمة عند تغييره.
  const iters = Math.max(10_000, Math.min(Number(env.PBKDF2_ITERATIONS) || ITERS, ITERS))
  return { salt, iters, hash: await derive(password, salt, iters, pepperOf(env)) }
}
const validPassword = (p) => typeof p === 'string' && [...p].length >= 8 && p.length <= 128
const B64 = (s, bytes) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && (() => { try { return unb64(s).length === bytes } catch { return false } })()

/** المخزَّن في c1: HMAC بالفلفل فوق برهان المتصفح */
async function seal1(proof, env) {
  const hk = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepperOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode('c1:' + proof)))
}
/** يقبل {salt, proof} من المتصفح (c1)، ويعيد ما يُخزَّن */
async function fromProof(b, env) {
  if (!B64(b.salt, 16) || !B64(b.proof, 32)) throw new HttpError(400, 'weak_password')
  return { salt: b.salt, iters: CLIENT_ITERS, hash: await seal1(b.proof, env) }
}
/** يتحقق من كلمة المرور: برهان c1، أو كلمة صريحة لتجزئات المخطط القديم فقط */
async function verify(u, b, env) {
  if (u.iters === CLIENT_ITERS) return B64(b.proof, 32) && same(await seal1(b.proof, env), u.hash)
  return typeof b.password === 'string' && b.password.length <= 128 && (await derive(b.password, u.salt, u.iters, pepperOf(env))) === u.hash
}

/** الملح والتكرارات قبل الدخول. لحساب غير موجود: ملح وهمي ثابت مشتق من الفلفل (لا يكشف وجود الحساب) */
export async function saltOf(b, env) {
  const DB = await needDB(env)
  const id = isText(b.id, 40) ? b.id : ''
  const u = id ? await one(DB, 'SELECT salt, iters, hash FROM users WHERE id = ?', id) : null
  if (u?.hash && u.iters === CLIENT_ITERS) return { salt: u.salt, iters: CLIENT_ITERS }
  if (u?.hash) return { salt: u.salt, iters: u.iters, legacy: true }
  const hk = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepperOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return { salt: b64(new Uint8Array(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode('fake-salt:' + id))).slice(0, 16)), iters: CLIENT_ITERS }
}

export async function setPassword(DB, userId, b, env) {
  // c1 من المتصفح؛ والكلمة الصريحة (المخطط القديم) للأدوات المحلية فقط
  const h = b.proof ? await fromProof(b, env) : validPassword(b.password) ? await hashPassword(b.password, env) : null
  if (!h) throw new HttpError(400, 'weak_password')
  await DB.batch([
    DB.prepare('UPDATE users SET salt = ?, hash = ?, iters = ?, pw_at = ?, failed = 0, locked_until = 0 WHERE id = ?').bind(h.salt, h.hash, h.iters, Date.now(), userId),
    // تغيير كلمة المرور ينهي كل الجلسات القائمة
    DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ])
}

const tokenOf = (request) => {
  const h = request.headers.get('authorization') ?? ''
  return h.startsWith('Bearer s:') ? h.slice(9) : null
}
export const hasSessionHeader = (request) => tokenOf(request) !== null

/** المستخدم من الجلسة، أو null. تمدد الجلسة الخاملة دون كتابة في كل طلب. */
export async function sessionUser(request, env) {
  const token = tokenOf(request)
  if (!token || token.length > 100) return null
  const DB = await db(env)
  if (!DB) return null
  const id = await sha256(token)
  const now = Date.now()
  const row = await one(DB, 'SELECT s.id, s.expires, s.seen, u.id AS uid, u.role, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', id)
  if (!row) return null
  if (row.expires < now || row.seen < now - IDLE_DAYS * 86400_000) {
    await run(DB, 'DELETE FROM sessions WHERE id = ?', id)
    return null
  }
  if (now - row.seen > 10 * 60_000) await run(DB, 'UPDATE sessions SET seen = ? WHERE id = ?', now, id)
  return { id: row.uid, role: row.role, name: row.name, session: id }
}

export async function requireUser(request, env, role) {
  const u = await sessionUser(request, env)
  if (!u) throw new HttpError(401, 'session')
  if (role && u.role !== role) throw new HttpError(403, 'forbidden')
  return u
}

async function needDB(env) {
  const DB = await db(env)
  if (!DB) throw new HttpError(503, 'no_db')
  return DB
}

/** عام: هل الحسابات مفعلة، وأسماء الطالبين فقط (دون أي بيانات أخرى) */
export async function status(env) {
  const DB = await db(env)
  if (!DB) return { accounts: false }
  const users = await all(DB, 'SELECT id, role, name, hash IS NOT NULL AS ready FROM users')
  return {
    accounts: true,
    setup: !users.some((u) => u.role === 'admin'),
    students: STUDENTS.map((s) => ({ id: s.id, name: users.find((u) => u.id === s.id)?.name ?? s.name, ready: !!users.find((u) => u.id === s.id)?.ready })),
  }
}

/** الإعداد الأول: يتطلب SETUP_CODE من أسرار الخادم، ولا يعمل بعد وجود مسؤول */
export async function setup(b, env) {
  const DB = await needDB(env)
  if (!env.SETUP_CODE || env.SETUP_CODE.length < 12) throw new HttpError(503, 'worker_setup')
  if (await one(DB, "SELECT id FROM users WHERE role = 'admin'")) throw new HttpError(409, 'already_setup')
  if (!isText(b.code, 200) || !(await same(b.code, env.SETUP_CODE))) throw new HttpError(401, 'setup_code')
  const h = b.proof ? await fromProof(b, env) : validPassword(b.password) ? await hashPassword(b.password, env) : null
  if (!h) throw new HttpError(400, 'weak_password')
  const now = Date.now()
  await DB.batch([
    DB.prepare('INSERT INTO users (id, role, name, salt, hash, iters, pw_at, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('admin', 'admin', 'المسؤول', h.salt, h.hash, h.iters, now, now),
    ...STUDENTS.map((s) => DB.prepare('INSERT OR IGNORE INTO users (id, role, name, created) VALUES (?, ?, ?, ?)').bind(s.id, 'student', s.name, now)),
  ])
  return { ok: true }
}

export async function login(b, env, request) {
  const DB = await needDB(env)
  const ip = request.headers.get('cf-connecting-ip') ?? 'local'
  const now = Date.now()
  const ipRow = await one(DB, 'SELECT since, n FROM login_fails WHERE ip = ?', ip)
  if (ipRow && ipRow.since > now - 3600_000 && ipRow.n >= IP_FAILS) throw new HttpError(429, 'locked', { retryAfter: Math.ceil((ipRow.since + 3600_000 - now) / 1000) })
  const fail = async () => {
    await run(DB, 'INSERT INTO login_fails (ip, since, n) VALUES (?, ?, 1) ON CONFLICT(ip) DO UPDATE SET n = CASE WHEN since < ? THEN 1 ELSE n + 1 END, since = CASE WHEN since < ? THEN ? ELSE since END', ip, now, now - 3600_000, now - 3600_000, now)
    // رسالة واحدة لكل الأسباب: لا تكشف هل الحساب موجود
    throw new HttpError(401, 'login')
  }
  if (!isText(b.id, 40) || (typeof b.password !== 'string' && typeof b.proof !== 'string')) return fail()
  const u = await one(DB, 'SELECT * FROM users WHERE id = ?', b.id)
  if (!u || !u.hash) return fail()
  if (u.locked_until > now) throw new HttpError(429, 'locked', { retryAfter: Math.ceil((u.locked_until - now) / 1000) })
  const ok = await verify(u, b, env)
  if (!ok) {
    const failed = u.failed + 1
    await run(DB, 'UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', failed >= MAX_FAILS ? 0 : failed, failed >= MAX_FAILS ? now + LOCK_MIN * 60_000 : 0, u.id)
    return fail()
  }
  const token = randomToken()
  const expires = now + SESSION_DAYS * 86400_000
  await DB.batch([
    DB.prepare('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?').bind(u.id),
    DB.prepare('INSERT INTO sessions (id, user_id, created, expires, seen) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), u.id, now, expires, now),
    DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ])
  return { token, expires, user: { id: u.id, role: u.role, name: u.name } }
}

export async function logout(request, env) {
  const u = await sessionUser(request, env)
  if (u) await run(await needDB(env), 'DELETE FROM sessions WHERE id = ?', u.session)
  return { ok: true }
}

export async function changeOwn(b, env, request) {
  const u = await requireUser(request, env)
  const DB = await needDB(env)
  const row = await one(DB, 'SELECT salt, hash, iters FROM users WHERE id = ?', u.id)
  if (!(await verify(row, { password: b.current, proof: b.currentProof }, env))) throw new HttpError(401, 'login')
  await setPassword(DB, u.id, b.next !== undefined ? { password: b.next } : b, env)
  return { ok: true }
}

/** المسؤول يحدد كلمة مرور طالب أو يعيد تعيينها، فتنتهي جلسات الطالب */
export async function adminSetPassword(b, env, request) {
  await requireUser(request, env, 'admin')
  const DB = await needDB(env)
  if (!STUDENTS.some((s) => s.id === b.userId) && b.userId !== 'admin') throw new HttpError(400, 'bad_request')
  await setPassword(DB, b.userId, b, env)
  return { ok: true }
}
