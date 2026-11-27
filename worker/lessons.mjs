/**
 * محتوى الدروس الجاهز: يجهّزه المسؤول مرة واحدة لكل درس، ويقرؤه الطالبان دون استهلاك حصة الذكاء الاصطناعي.
 * المحتوى مشترك (ليس بيانات طالب)، ولا يُقرأ إلا بجلسة صالحة لأنه مقتبس من كتب المكتبة المشفرة.
 */
import * as auth from './auth.mjs'
import { all, db, one, run } from './db.mjs'
import { HttpError } from './http.mjs'
import { excludedOf, heldFor, holdKey } from './placement.mjs'

const ID = /^[A-Za-z0-9_-]{1,80}$/
const STATUS = ['ai', 'reviewed', 'hidden']
const PARTS = ['steps', 'summary', 'guide', 'terms', 'laws', 'points', 'mistakes', 'mindmap', 'qa', 'cards', 'quiz', 'worksheet']
export const MAX_PACK = 400_000

async function need(env) {
  const DB = await db(env)
  if (!DB) throw new HttpError(503, 'no_db')
  return DB
}
const ids = (book, section) => {
  if (!ID.test(book) || !ID.test(section)) throw new HttpError(400, 'bad_request')
}

/** ما الجاهز من كل درس، دون المحتوى نفسه: للوحة المسؤول وللطالب ليعرف ما يُنزَّل */
export async function index(request, env) {
  const u = await auth.requireUser(request, env)
  const DB = await need(env)
  const rows = await all(DB, "SELECT book_id, section_id, title, parts, status, model, updated, size, json_extract(json, '$.subject') AS subject FROM lessons ORDER BY book_id, section_id")
  const x = excludedOf(u)
  // hold: بصمة أسئلة تحديد المستوى المحجوبة؛ تغيّرها يجعل المتصفح يعيد تنزيل الحزم
  return { hold: await holdKey(DB, u), lessons: rows.filter((r) => (u.role === 'admin' || r.status !== 'hidden') && (!x || r.subject !== x)).map((r) => ({ bookId: r.book_id, sectionId: r.section_id, title: r.title, parts: JSON.parse(r.parts), status: r.status, model: r.model, updated: r.updated, size: r.size })) }
}

/** كل دروس كتاب جاهزة دفعة واحدة */
export async function ofBook(request, env, book) {
  const u = await auth.requireUser(request, env)
  if (!ID.test(book)) throw new HttpError(400, 'bad_request')
  const DB = await need(env)
  const rows = await all(DB, 'SELECT section_id, json, status, updated FROM lessons WHERE book_id = ?', book)
  // المادة المستثناة للطالب: ممنوعة من الخادم ولو طُلبت مباشرة
  const x = excludedOf(u)
  if (x && rows.some((r) => JSON.parse(r.json).subject === x)) throw new HttpError(403, 'subject')
  // أسئلة تحديد المستوى لا تصل إلى الطالب ضمن الدرس قبل أن تظهر نتائجه
  const held = await heldFor(DB, u, book)
  const strip = (p) => (held?.size && Array.isArray(p.quiz) ? { ...p, quiz: p.quiz.filter((x) => !held.has(x?.q)) } : p)
  return { bookId: book, hold: await holdKey(DB, u), lessons: rows.filter((r) => u.role === 'admin' || r.status !== 'hidden').map((r) => ({ ...strip(JSON.parse(r.json)), status: r.status, updated: r.updated })) }
}

export async function put(request, env, book, section, body) {
  await auth.requireUser(request, env, 'admin')
  ids(book, section)
  const DB = await need(env)
  const p = body?.pack
  if (!p || typeof p !== 'object' || p.bookId !== book || p.sectionId !== section || typeof p.title !== 'string') throw new HttpError(400, 'bad_request')
  const parts = PARTS.filter((k) => {
    const v = p[k]
    return Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : typeof v === 'string' && v.length > 0
  })
  // «جاهز» = فُحص فلا أداة ناقصة ولا استشهاد أو إجابة غير صالحة؛ و«flagged» = فيه بنود تحتاج مراجعة
  const r = p.review
  if (r && Array.isArray(r.missing) && Array.isArray(r.issues) && !r.missing.length && !r.issues.length) parts.push('checked')
  if (r?.flagged > 0) parts.push('flagged')
  if (r?.verified === 'independent') parts.push('verified')
  if (Number.isInteger(r?.v)) parts.push(`rv${r.v}`)
  const json = JSON.stringify(p)
  if (json.length > MAX_PACK) throw new HttpError(413, 'too_large')
  const now = Date.now()
  await run(DB, `INSERT INTO lessons (book_id, section_id, title, json, parts, status, model, updated, size) VALUES (?, ?, ?, ?, ?, 'ai', ?, ?, ?)
    ON CONFLICT (book_id, section_id) DO UPDATE SET title = excluded.title, json = excluded.json, parts = excluded.parts, status = 'ai', model = excluded.model, updated = excluded.updated, size = excluded.size`,
    book, section, p.title.slice(0, 200), json, JSON.stringify(parts), String(p.model ?? '').slice(0, 80), now, json.length)
  return { ok: true, parts, updated: now }
}

/** مراجعة المسؤول: reviewed بعد التدقيق، hidden لإخفاء درس فيه خطأ حتى يُعاد تجهيزه */
export async function patch(request, env, book, section, body) {
  await auth.requireUser(request, env, 'admin')
  ids(book, section)
  if (!STATUS.includes(body?.status)) throw new HttpError(400, 'bad_request')
  const DB = await need(env)
  const r = await run(DB, 'UPDATE lessons SET status = ? WHERE book_id = ? AND section_id = ?', body.status, book, section)
  if (!r.meta?.changes && !(await one(DB, 'SELECT 1 AS x FROM lessons WHERE book_id = ? AND section_id = ?', book, section))) throw new HttpError(404, 'not_found')
  return { ok: true }
}
