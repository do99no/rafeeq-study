/**
 * قاعدة بيانات رفيق (Cloudflare D1). الفصل بين الطالبين مفروض هنا: كل استعلام يقيّد بـ user_id
 * المأخوذ من الجلسة في الخادم، لا من الطلب.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, salt TEXT, hash TEXT, iters INTEGER, pw_at INTEGER, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS login_fails (ip TEXT PRIMARY KEY, since INTEGER NOT NULL, n INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS docs (user_id TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, v INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, why TEXT NOT NULL, json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS backups_user ON backups(user_id, at)`,
  `CREATE TABLE IF NOT EXISTS study (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prev_id TEXT, start INTEGER NOT NULL, last INTEGER NOT NULL, end INTEGER, active_ms INTEGER NOT NULL DEFAULT 0, paused_ms INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, returns INTEGER NOT NULL DEFAULT 0, offline INTEGER NOT NULL DEFAULT 0, idle INTEGER NOT NULL DEFAULT 0, end_reason TEXT, subject TEXT, book_id TEXT, book TEXT, lesson TEXT, tasks TEXT NOT NULL DEFAULT '{}', seq INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS study_user ON study(user_id, start)`,
  `CREATE TABLE IF NOT EXISTS study_time (user_id TEXT NOT NULL, day TEXT NOT NULL, subject TEXT NOT NULL, book TEXT NOT NULL, lesson TEXT NOT NULL, active_ms INTEGER NOT NULL, PRIMARY KEY (user_id, day, subject, book, lesson))`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, subject TEXT, book TEXT, lesson TEXT, detail TEXT, session_id TEXT, queued INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS events_user ON events(user_id, at)`,
  `CREATE TABLE IF NOT EXISTS plans (user_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated INTEGER NOT NULL)`,
  // آخر لحظة احتُسب حتى نهايتها وقت دراسة للطالب: يمنع احتساب الوقت مرتين من تبويبين أو جهازين
  `CREATE TABLE IF NOT EXISTS logins (user_id TEXT PRIMARY KEY, last INTEGER NOT NULL, n INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS study_credit (user_id TEXT PRIMARY KEY, until INTEGER NOT NULL)`,
  // المجموعة المشتركة لمفاتيح الذكاء الاصطناعي (worker/keys.mjs)
  `CREATE TABLE IF NOT EXISTS ai_keys (id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'unassigned', project TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, env_name TEXT, enc TEXT, last4 TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'unknown', last_ok INTEGER, last_used INTEGER, last_error TEXT, last_error_at INTEGER, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_quota (provider TEXT NOT NULL, project TEXT NOT NULL, cool_until INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (provider, project))`,
  `CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, key_id TEXT NOT NULL, provider TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key_id, model, user_id, kind))`,
  `CREATE TABLE IF NOT EXISTS ai_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, key_id TEXT, provider TEXT NOT NULL, project TEXT, model TEXT, code TEXT NOT NULL, status INTEGER, user_id TEXT)`,
  // مهلة الحصة لكل نموذج: Google تحسب حد الدقيقة واليوم لكل نموذج في المشروع
  `CREATE TABLE IF NOT EXISTS ai_cool (provider TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL, cool_until INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (provider, project, model))`,
  // محتوى الدروس الجاهز (worker/lessons.mjs): مشترك بين الطالبين، يكتبه المسؤول فقط
  `CREATE TABLE IF NOT EXISTS lessons (book_id TEXT NOT NULL, section_id TEXT NOT NULL, title TEXT NOT NULL, json TEXT NOT NULL, parts TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ai', model TEXT, updated INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (book_id, section_id))`,
  // اختبار تحديد المستوى (worker/placement.mjs)
  `CREATE TABLE IF NOT EXISTS placement_bank (subject TEXT PRIMARY KEY, json TEXT NOT NULL, n INTEGER NOT NULL, published INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS placement_journey (user_id TEXT PRIMARY KEY, subjects TEXT NOT NULL, started INTEGER NOT NULL, completed INTEGER)`,
  `CREATE TABLE IF NOT EXISTS placement (user_id TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', elapsed_ms INTEGER NOT NULL DEFAULT 0, started INTEGER NOT NULL, saved INTEGER NOT NULL, submitted INTEGER, score INTEGER, total INTEGER, PRIMARY KEY (user_id, subject))`,
  `CREATE TABLE IF NOT EXISTS placement_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_providers (id TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0, approved_at INTEGER, confirm TEXT)`,
]

const ready = new WeakSet()
export async function db(env) {
  if (!env.DB) return null
  if (!ready.has(env.DB)) {
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)))
    ready.add(env.DB)
  }
  return env.DB
}

export const q = (DB, sql, ...args) => DB.prepare(sql).bind(...args)
export const one = (DB, sql, ...args) => q(DB, sql, ...args).first()
export const all = async (DB, sql, ...args) => (await q(DB, sql, ...args).all()).results ?? []
export const run = (DB, sql, ...args) => q(DB, sql, ...args).run()

/** يوم الدراسة بتوقيت السودان (UTC+2) */
export const dayOf = (ms) => new Date(ms + 2 * 3600_000).toISOString().slice(0, 10)
