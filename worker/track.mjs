/**
 * وقت الدراسة الفعلي وسجل النشاط التعليمي.
 * الجهاز يحسب الوقت النشط (صفحة مرئية + داخل الدراسة + تفاعل حديث + اتصال)، والخادم لا يقبل
 * في كل نبضة وقتاً نشطاً أكبر من الزمن المنقضي فعلاً منذ النبضة السابقة بتوقيته هو.
 * لا يُسجَّل نص ما يكتبه الطالب ولا ضغطات المفاتيح ولا صور أو صوت.
 */
import { requireUser } from './auth.mjs'
import { all, dayOf, db, one, run } from './db.mjs'
import { HttpError, isText } from './http.mjs'

/** بلا نبضة لهذه المدة تُغلق الجلسة بسبب «غير معروف» */
export const STALE_MS = 3 * 60_000
const SLACK_MS = 15_000
const MAX_BEAT_MS = 90_000

export const EVENT_TYPES = new Set([
  'session_start', 'session_end', 'hidden', 'visible', 'idle', 'active', 'offline', 'online', 'pagehide', 'logout',
  'book_start', 'lesson_open', 'explain', 'explain_done', 'teach', 'answer_right', 'answer_wrong', 'answer_partial',
  'quiz_done', 'summary', 'cards', 'cards_review', 'weak_revisit', 'read_page', 'paragraph', 'output_open',
])
const TASKS = new Set(['explain', 'teach', 'check', 'summary', 'quiz', 'cards', 'read', 'answer', 'review', 'other'])
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null)
const ctxOf = (c) => ({ subject: clip(c?.subject, 60), bookId: clip(c?.bookId, 40), book: clip(c?.book, 120), lesson: clip(c?.lesson, 160) })

async function student(request, env) {
  const u = await requireUser(request, env)
  if (u.role !== 'student') throw new HttpError(403, 'forbidden')
  return { u, DB: await db(env) }
}

/** يغلق جلسات الطالب المعلّقة التي انقطعت نبضاتها */
export async function closeStale(DB, userId) {
  await run(DB, "UPDATE study SET end = last, end_reason = 'unknown' WHERE user_id = ? AND end IS NULL AND last < ?", userId, Date.now() - STALE_MS)
}

export async function start(request, env, b) {
  const { u, DB } = await student(request, env)
  if (!isText(b.id, 40) || !/^[A-Za-z0-9_-]+$/.test(b.id)) throw new HttpError(400, 'bad_request')
  await closeStale(DB, u.id)
  const now = Date.now()
  // جلسة سابقة قريبة: تُربط بها الجديدة (عودة بعد مغادرة)
  let prev = null
  if (isText(b.prevId, 40)) prev = await one(DB, 'SELECT id FROM study WHERE id = ? AND user_id = ?', b.prevId, u.id)
  const c = ctxOf(b.context)
  await run(DB, 'INSERT OR IGNORE INTO study (id, user_id, prev_id, start, last, subject, book_id, book, lesson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', b.id, u.id, prev?.id ?? null, now, now, c.subject, c.bookId, c.book, c.lesson)
  return { id: b.id, now }
}

/** نبضة: فرق الوقت النشط والمتوقف والعدادات منذ النبضة السابقة */
export async function beat(request, env, b, final = false) {
  const { u, DB } = await student(request, env)
  const s = await one(DB, 'SELECT * FROM study WHERE id = ? AND user_id = ?', b.id, u.id)
  if (!s) throw new HttpError(404, 'not_found')
  if (s.end) return { ended: true }
  if (!Number.isInteger(b.seq) || b.seq <= s.seq) return { dup: true }
  const now = Date.now()
  const n = (x, max) => (Number.isFinite(x) && x > 0 ? Math.min(Math.round(x), max) : 0)
  // الحد الأعلى: الزمن المنقضي فعلاً على الخادم منذ آخر نبضة
  const cap = Math.min(now - s.last + SLACK_MS, MAX_BEAT_MS)
  const claimed = n(b.activeMs, cap)
  // تبويبان أو جهازان في الوقت نفسه: لا يُحتسب إلا الجزء الذي لم يُحتسب بعد من الفترة
  const credit = (await one(DB, 'SELECT until FROM study_credit WHERE user_id = ?', u.id))?.until ?? 0
  const from = Math.max(now - claimed, credit)
  const active = Math.max(0, Math.min(claimed, now - from))
  const paused = n(b.pausedMs, 24 * 3600_000)
  const c = ctxOf(b.context)
  const tasks = JSON.parse(s.tasks || '{}')
  if (active && TASKS.has(b.task)) tasks[b.task] = (tasks[b.task] ?? 0) + active
  const stmts = [
    DB.prepare(
      'UPDATE study SET last = ?, seq = ?, active_ms = active_ms + ?, paused_ms = paused_ms + ?, hidden = hidden + ?, returns = returns + ?, offline = offline + ?, idle = idle + ?, tasks = ?, subject = COALESCE(?, subject), book_id = COALESCE(?, book_id), book = COALESCE(?, book), lesson = COALESCE(?, lesson)' +
        (final ? ', end = ?, end_reason = ?' : '') + ' WHERE id = ?',
    ).bind(now, b.seq, active, paused, n(b.hidden, 1000), n(b.returns, 1000), n(b.offline, 1000), n(b.idle, 1000), JSON.stringify(tasks), c.subject, c.bookId, c.book, c.lesson, ...(final ? [now, clip(b.reason, 20) ?? 'left'] : []), b.id),
  ]
  if (active) stmts.push(DB.prepare('INSERT INTO study_credit (user_id, until) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET until = MAX(until, excluded.until)').bind(u.id, now))
  if (active) stmts.push(DB.prepare('INSERT INTO study_time (user_id, day, subject, book, lesson, active_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day, subject, book, lesson) DO UPDATE SET active_ms = active_ms + excluded.active_ms').bind(u.id, dayOf(now), c.subject ?? s.subject ?? '', c.book ?? s.book ?? '', c.lesson ?? s.lesson ?? '', active))
  await DB.batch(stmts)
  return { ok: true, accepted: active }
}

export const end = (request, env, b) => beat(request, env, b, true)

/** أحداث السجل التعليمي، دفعة واحدة. الأحداث المؤجلة (دون اتصال) تُعلَّم بذلك */
export async function events(request, env, b) {
  const { u, DB } = await student(request, env)
  if (!Array.isArray(b.events) || b.events.length > 100) throw new HttpError(400, 'bad_request')
  const now = Date.now()
  const list = b.events.filter((e) => e && EVENT_TYPES.has(e.type) && Number.isFinite(e.at))
  if (list.length)
    await DB.batch(
      list.map((e) => {
        const c = ctxOf(e)
        const at = Math.min(Math.max(e.at, now - 7 * 86400_000), now + 60_000)
        return DB.prepare('INSERT INTO events (user_id, at, type, subject, book, lesson, detail, session_id, queued) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(u.id, at, e.type, c.subject, c.book, c.lesson, clip(e.detail, 300), clip(e.session, 40), e.queued ? 1 : 0)
      }),
    )
  return { ok: true, n: list.length }
}

/** خطة الطالب نفسه: يراها ليعرف أهدافه */
export async function ownPlan(request, env) {
  const { u, DB } = await student(request, env)
  const row = await one(DB, 'SELECT json FROM plans WHERE user_id = ?', u.id)
  const today = dayOf(Date.now())
  const mins = await one(DB, 'SELECT COALESCE(SUM(active_ms), 0) AS ms FROM study_time WHERE user_id = ? AND day = ?', u.id, today)
  return { plan: row ? JSON.parse(row.json) : null, todayMs: mins?.ms ?? 0 }
}

export { all }
