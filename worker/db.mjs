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
