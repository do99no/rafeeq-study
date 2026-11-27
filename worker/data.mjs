/**
 * بيانات الطالب الدراسية على الخادم: «core» (الدفاتر والمخرجات والنتائج والتقدم والإعدادات)
 * و«chat:<معرّف>» لكل محادثة. صاحب البيانات وحده يكتبها؛ المسؤول يقرؤها فقط.
 */
import { requireUser, STUDENTS } from './auth.mjs'
import { all, db, one, run } from './db.mjs'
import { HttpError } from './http.mjs'

const KEY = /^(core|chat:[A-Za-z0-9_-]{1,40})$/
const MAX_DOC = 1_800_000
const KEEP_DAYS = 30

export async function readAll(DB, userId) {
  return all(DB, 'SELECT key, json, v, updated FROM docs WHERE user_id = ?', userId)
}

/** GET /data: بيانات صاحب الجلسة فقط */
export async function getOwn(request, env) {
  const u = await requireUser(request, env)
  return { docs: await readAll(await db(env), u.id) }
}

/** PUT /data/<key>: كتابة متفائلة بنسخة أساس؛ عند التعارض يُعاد الموجود ليدمجه الجهاز */
export async function putOwn(request, env, key) {
  const u = await requireUser(request, env)
  if (!KEY.test(key)) throw new HttpError(400, 'bad_request')
  const text = await request.text()
  if (text.length > MAX_DOC + 100) throw new HttpError(413, 'too_large')
  let b
  try {
    b = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_request')
  }
  if (typeof b.json !== 'string' || b.json.length > MAX_DOC || !Number.isInteger(b.base)) throw new HttpError(400, 'bad_request')
  try {
    JSON.parse(b.json)
  } catch {
    throw new HttpError(400, 'bad_request')
  }
  const DB = await db(env)
  const cur = await one(DB, 'SELECT json, v FROM docs WHERE user_id = ? AND key = ?', u.id, key)
  if ((cur?.v ?? 0) !== b.base) throw new HttpError(409, 'conflict', { v: cur?.v ?? 0, json: cur?.json ?? null })
  const v = (cur?.v ?? 0) + 1
  await run(DB, 'INSERT INTO docs (user_id, key, json, v, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET json = excluded.json, v = excluded.v, updated = excluded.updated', u.id, key, b.json, v, Date.now())
  return { v }
}

export async function deleteOwn(request, env, key) {
  const u = await requireUser(request, env)
  if (!KEY.test(key) || key === 'core') throw new HttpError(400, 'bad_request')
  await run(await db(env), 'DELETE FROM docs WHERE user_id = ? AND key = ?', u.id, key)
  return { ok: true }
}

/** نسخة كاملة من بيانات طالب داخل جدول النسخ */
export async function snapshot(DB, userId, why) {
  const docs = await readAll(DB, userId)
  if (!docs.length) return null
  const r = await run(DB, 'INSERT INTO backups (user_id, at, why, json) VALUES (?, ?, ?, ?)', userId, Date.now(), why, JSON.stringify(docs))
  return r.meta?.last_row_id ?? null
}

/** نسخ احتياطي يومي (Cron) مع حذف ما تجاوز 30 يوماً */
export async function dailyBackup(env) {
  const DB = await db(env)
  if (!DB) return
  for (const s of STUDENTS) await snapshot(DB, s.id, 'daily')
  await run(DB, 'DELETE FROM backups WHERE at < ?', Date.now() - KEEP_DAYS * 86400_000)
}

export async function listBackups(request, env, userId) {
  await requireUser(request, env, 'admin')
  return { backups: await all(await db(env), 'SELECT id, at, why, length(json) AS size FROM backups WHERE user_id = ? ORDER BY at DESC LIMIT 60', userId) }
}

/** استعادة نسخة: تُحفظ الحالية أولاً، ثم تُستبدل بيانات الطالب بالنسخة */
export async function restore(request, env, b) {
  await requireUser(request, env, 'admin')
  const DB = await db(env)
  if (!STUDENTS.some((s) => s.id === b.userId) || !Number.isInteger(b.backupId)) throw new HttpError(400, 'bad_request')
  const row = await one(DB, 'SELECT json FROM backups WHERE id = ? AND user_id = ?', b.backupId, b.userId)
  if (!row) throw new HttpError(404, 'not_found')
  await snapshot(DB, b.userId, 'before-restore')
  const docs = JSON.parse(row.json)
  const now = Date.now()
  // رقم النسخة يتقدم فلا تكتب الأجهزة القديمة فوق المستعاد دون دمج
  const maxV = (await one(DB, 'SELECT MAX(v) AS v FROM docs WHERE user_id = ?', b.userId))?.v ?? 0
  await DB.batch([
    DB.prepare('DELETE FROM docs WHERE user_id = ?').bind(b.userId),
    ...docs.map((d) => DB.prepare('INSERT INTO docs (user_id, key, json, v, updated) VALUES (?, ?, ?, ?, ?)').bind(b.userId, d.key, d.json, maxV + d.v + 1, now)),
  ])
  return { ok: true, docs: docs.length }
}
