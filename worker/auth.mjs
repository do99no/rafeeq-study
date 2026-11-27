/**
 * حسابات رفيق: مسؤول وطالبان. لا تسجيل من صفحة الدخول، وكلمات المرور يحددها المسؤول.
 *
 * التجزئة: PBKDF2-SHA256 بملح عشوائي لكل مستخدم و«فلفل» سري (PASSWORD_PEPPER) لا يوجد إلا في أسرار الخادم.
 * Argon2id غير عملي في Cloudflare Workers المجانية (حد المعالج نحو 10ms للطلب ولا تتوفر له واجهة أصلية)،
 * و100000 تكرار هي الحد الأعلى الذي تقبله Workers لـ PBKDF2. يكمّل ذلك: قفل الحساب بعد محاولات فاشلة،
 * وحد لكل عنوان IP، وكلمات مرور لا تقل عن 8 أحرف.
 */
import { all, db, one, run } from './db.mjs'
import { b64, HttpError, isText, randomToken, same, sha256, unb64 } from './http.mjs'

export const ITERS = 100_000
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
  return { salt, iters: ITERS, hash: await derive(password, salt, ITERS, pepperOf(env)) }
}
const validPassword = (p) => typeof p === 'string' && [...p].length >= 8 && p.length <= 128

export async function setPassword(DB, userId, password, env) {
  if (!validPassword(password)) throw new HttpError(400, 'weak_password')
  const h = await hashPassword(password, env)
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
  if (!validPassword(b.password)) throw new HttpError(400, 'weak_password')
  const h = await hashPassword(b.password, env)
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
  if (!isText(b.id, 40) || typeof b.password !== 'string' || b.password.length > 128) return fail()
  const u = await one(DB, 'SELECT * FROM users WHERE id = ?', b.id)
  if (!u || !u.hash) return fail()
  if (u.locked_until > now) throw new HttpError(429, 'locked', { retryAfter: Math.ceil((u.locked_until - now) / 1000) })
  const ok = (await derive(b.password, u.salt, u.iters, pepperOf(env))) === u.hash
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
  if (typeof b.current !== 'string' || (await derive(b.current, row.salt, row.iters, pepperOf(env))) !== row.hash) throw new HttpError(401, 'login')
  await setPassword(DB, u.id, b.next, env)
  return { ok: true }
}

/** المسؤول يحدد كلمة مرور طالب أو يعيد تعيينها، فتنتهي جلسات الطالب */
export async function adminSetPassword(b, env, request) {
  await requireUser(request, env, 'admin')
  const DB = await needDB(env)
  if (!STUDENTS.some((s) => s.id === b.userId) && b.userId !== 'admin') throw new HttpError(400, 'bad_request')
  await setPassword(DB, b.userId, b.password, env)
  return { ok: true }
}
