// بديل محلي لـ Cloudflare D1 فوق node:sqlite، للتطوير والاختبار دون حساب Cloudflare.
// يحاكي ما يستخدمه رفيق فقط: prepare/bind/first/all/run و batch.
import { DatabaseSync } from 'node:sqlite'

export function localD1(file) {
  const sql = new DatabaseSync(file)
  sql.exec('PRAGMA journal_mode = WAL')
  const stmt = (text, args = []) => ({
    bind: (...a) => stmt(text, a),
    async first(col) {
      const r = sql.prepare(text).get(...args)
      return r === undefined ? null : col ? r[col] : { ...r }
    },
    async all() {
      return { results: sql.prepare(text).all(...args).map((r) => ({ ...r })), success: true }
    },
    async run() {
      const r = sql.prepare(text).run(...args)
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    },
    text,
    args,
  })
  return {
    prepare: (text) => stmt(text),
    async batch(list) {
      sql.exec('BEGIN')
      try {
        const out = []
        for (const s of list) out.push(/^\s*(select|with)/i.test(s.text) ? await s.all() : await s.run())
        sql.exec('COMMIT')
        return out
      } catch (e) {
        sql.exec('ROLLBACK')
        throw e
      }
    },
    async exec(text) {
      sql.exec(text)
    },
  }
}
