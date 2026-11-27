/**
 * لوحة متابعة الطلاب: للمسؤول وحده. تُحسب الأرقام من سجلات الخادم (الجلسات والوقت والأحداث)
 * ومن بيانات الطالب المتزامنة (النتائج والتقدم والبطاقات والأخطاء).
 */
import { requireUser, STUDENTS } from './auth.mjs'
import { all, dayOf, db, one, run } from './db.mjs'
import { readAll } from './data.mjs'
import { HttpError } from './http.mjs'
import { closeStale } from './track.mjs'

const DAY = 86400_000
const pct = (a) => (a.total ? a.score / a.total : 0)
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

const studentOr404 = (id) => {
  if (!STUDENTS.some((s) => s.id === id)) throw new HttpError(404, 'not_found')
}

/** الدرس مكتمل: أنهى التعليم خطوة بخطوة، أو شُرح ونجح في أسئلة الفهم (60% فأكثر من سؤالين على الأقل) أو في اختبار الدرس */
function lessons(core) {
  const studied = Object.values(core?.studied ?? {})
  const outputs = core?.outputs ?? []
  const attempts = core?.attempts ?? []
  const quizOf = new Map()
  for (const a of attempts) {
    const o = outputs.find((x) => x.id === a.outputId)
    const t = o?.title?.replace(/^اختبار:\s*/, '')
    if (t) quizOf.set(t, Math.max(quizOf.get(t) ?? 0, pct(a)))
  }
  const weakTopics = new Set((core?.mistakes ?? []).filter((m) => !m.resolved).map((m) => m.topic))
  return studied.map((s) => {
    const ratio = s.checks?.total ? s.checks.right / s.checks.total : null
    const quiz = quizOf.get(s.title)
    const done = !!(s.taught && s.taught.k >= s.taught.n) || (!!s.explained && ((ratio !== null && s.checks.total >= 2 && ratio >= 0.6) || (quiz ?? 0) >= 0.6))
    const review = (ratio !== null && ratio < 0.6) || (quiz !== undefined && quiz < 0.6) || weakTopics.has(s.title)
    return { key: s.key, title: s.title, bookId: s.bookId, at: s.at, done, review, ratio, quiz: quiz ?? null }
  })
}

function cardsDue(core, now) {
  let due = 0, hard = 0, total = 0
  for (const o of core?.outputs ?? [])
    if (o.data?.kind === 'cards')
      for (const c of o.data.cards ?? []) {
        total++
        if ((c.box ?? 0) < 5 && (c.due ?? 0) <= now) due++
        if (c.hard) hard++
      }
  return { due, hard, total }
}

/** التدريب: أوراق العمل، ومحاولات الامتحانات، والاختبارات المختلطة، وحجم بنك الأسئلة */
function training(core) {
  const quiz = (core?.outputs ?? []).filter((o) => o.data?.kind === 'quiz')
  const mode = (o) => o.data.meta?.mode
  const byId = new Map(quiz.map((o) => [o.id, o]))
  const attempts = (core?.attempts ?? []).filter((a) => byId.has(a.outputId))
  const bank = new Set(quiz.flatMap((o) => (o.data.questions ?? []).filter((q) => !q.pageTask).map((q) => q.q)))
  return { worksheets: quiz.filter((o) => mode(o) === 'worksheet').length, examAttempts: attempts.filter((a) => mode(byId.get(a.outputId)) === 'exam').length, mixed: quiz.filter((o) => mode(o) === 'mixed').length, bank: bank.size }
}

async function summary(DB, id, full = false) {
  await closeStale(DB, id)
  const now = Date.now()
  const today = dayOf(now)
  const week = dayOf(now - 6 * DAY)
  const month = today.slice(0, 7)
  const times = await all(DB, 'SELECT day, subject, book, lesson, active_ms FROM study_time WHERE user_id = ?', id)
  const sum = (f) => times.filter(f).reduce((s, r) => s + r.active_ms, 0)
  const sessions = await all(DB, 'SELECT * FROM study WHERE user_id = ? ORDER BY start DESC', id)
  const real = sessions.filter((s) => s.active_ms > 0)
  const docs = await readAll(DB, id)
  const coreRow = docs.find((d) => d.key === 'core')
  const core = coreRow ? JSON.parse(coreRow.json) : null
  const ls = lessons(core)
  const attempts = (core?.attempts ?? []).slice().sort((a, b) => a.at - b.at)
  const outputs = core?.outputs ?? []
  const trend = attempts.map((a) => ({ at: a.at, pct: Math.round(pct(a) * 100), title: outputs.find((o) => o.id === a.outputId)?.title ?? 'اختبار' }))
  const weak = {}
  for (const m of core?.mistakes ?? []) if (!m.resolved) weak[m.topic] = { topic: m.topic, book: m.bookTitle, n: (weak[m.topic]?.n ?? 0) + 1, last: Math.max(weak[m.topic]?.last ?? 0, m.at) }
  const last = real[0]
  const planRow = await one(DB, 'SELECT json FROM plans WHERE user_id = ?', id)
  const login = await one(DB, 'SELECT last, n FROM logins WHERE user_id = ?', id)
  const activities = (await one(DB, "SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND type IN ('explain', 'explain_done', 'teach', 'answer_right', 'answer_wrong', 'answer_partial', 'quiz_done', 'summary', 'cards', 'cards_review', 'weak_revisit', 'read_page', 'paragraph', 'lesson_open')", id))?.n ?? 0
  // تقدم كل كتاب: الدروس المكتملة من الدروس التي درسها، ووقته
  const titleOf = (bid) => (core?.books ?? []).find((b) => b.id === bid)?.title ?? bid
  const perBook = Object.values(ls.reduce((m, l) => { const k = l.bookId; m[k] ??= { book: titleOf(k), lessons: 0, done: 0, review: 0, ms: 0 }; m[k].lessons++; if (l.done) m[k].done++; if (l.review) m[k].review++; return m }, {}))
  for (const r of times) { const b = perBook.find((x) => x.book === r.book); if (b) b.ms += r.active_ms }
  const plan = planRow ? JSON.parse(planRow.json) : null

  // الالتزام: نسبة الهدف اليومي المتحقق في آخر 7 أيام
  const byDay = {}
  for (const r of times) byDay[r.day] = (byDay[r.day] ?? 0) + r.active_ms
  const days7 = Array.from({ length: 7 }, (_, i) => dayOf(now - i * DAY))
  const adherence = plan?.dailyMin ? Math.round((days7.reduce((s, d) => s + Math.min(1, (byDay[d] ?? 0) / (plan.dailyMin * 60_000)), 0) / 7) * 100) : null
  const planLessons = (plan?.lessons ?? []).map((l) => ({ ...l, done: ls.some((x) => x.key === l.key && x.done) }))

  // تحسن النتائج: هذا الأسبوع مقابل الأسبوع السابق
  const wk = (from, to) => attempts.filter((a) => a.at >= from && a.at < to).map(pct)
  const thisW = wk(now - 7 * DAY, now + 1)
  const prevW = wk(now - 14 * DAY, now - 7 * DAY)
  const week7 = sum((r) => r.day >= week)
  const insights = []
  const weakList = Object.values(weak).sort((a, b) => b.n - a.n)
  if (week7 >= 3 * 3600_000 && thisW.length >= 2 && ((prevW.length >= 2 && avg(thisW) <= avg(prevW)) || avg(thisW) < 0.6))
    insights.push({ kind: 'no_progress', text: 'وقت دراسة كثير هذا الأسبوع دون تحسن في نتائج الاختبارات. المقترح: إعادة شرح الموضوعات الضعيفة بمستوى «مبسط جداً»، ثم أسئلة فهم قصيرة، ثم اختبار جديد.', topics: weakList.slice(0, 5).map((w) => w.topic) })
  if (week7 >= 2 * 3600_000 && !thisW.length) insights.push({ kind: 'no_quiz', text: 'درس أكثر من ساعتين هذا الأسبوع دون أي اختبار؛ لا يمكن معرفة هل تحسّن. المقترح: اختبار قصير على الدروس الأخيرة.' })
  const hid = real.slice(0, 20).reduce((s, x) => s + x.hidden, 0)
  if (real.length >= 3 && hid / Math.min(real.length, 20) >= 6) insights.push({ kind: 'distracted', text: 'يغادر صفحة الدراسة كثيراً أثناء الجلسات (أكثر من 6 مرات في الجلسة في المتوسط).' })
  if (weakList.some((w) => w.n >= 3)) insights.push({ kind: 'repeat_weak', text: 'أخطاء متكررة في الموضوع نفسه: ' + weakList.filter((w) => w.n >= 3).map((w) => w.topic).slice(0, 3).join('، ') + '. المقترح: مراجعة الدرس من الكتاب ثم «علّمني خطوة بخطوة».' })
  if (plan?.dailyMin && adherence !== null && adherence < 50) insights.push({ kind: 'plan', text: `الالتزام بالهدف اليومي ${adherence}% في آخر 7 أيام.` })

  const out = {
    id,
    name: STUDENTS.find((s) => s.id === id).name,
    totalMs: sum(() => true),
    todayMs: sum((r) => r.day === today),
    weekMs: week7,
    monthMs: sum((r) => r.day.startsWith(month)),
    sessions: real.length,
    avgSessionMs: real.length ? Math.round(real.reduce((s, x) => s + x.active_ms, 0) / real.length) : 0,
    hidden: sessions.reduce((s, x) => s + x.hidden, 0),
    returns: sessions.reduce((s, x) => s + x.returns, 0),
    offline: sessions.reduce((s, x) => s + x.offline, 0),
    idle: sessions.reduce((s, x) => s + x.idle, 0),
    endReasons: sessions.reduce((m, x) => (x.end_reason ? { ...m, [x.end_reason]: (m[x.end_reason] ?? 0) + 1 } : m), {}),
    last: last ? { at: last.last, subject: last.subject, book: last.book, lesson: last.lesson } : null,
    lessonsDone: ls.filter((l) => l.done).length,
    lessonsReview: ls.filter((l) => l.review).length,
    quizzes: attempts.length,
    avgScore: attempts.length ? Math.round(avg(attempts.map(pct)) * 100) : null,
    trend,
    weak: weakList.slice(0, 10),
    cards: cardsDue(core, now),
    plan,
    adherence,
    planLessons,
    insights,
    synced: coreRow?.updated ?? null,
    training: training(core),
    studyDays: new Set(times.filter((r) => r.active_ms > 0).map((r) => r.day)).size,
    lastLogin: login?.last ?? null,
    logins: login?.n ?? 0,
    activities,
    perBook,
  }
  if (!full) return out
  const daily = Array.from({ length: 30 }, (_, i) => dayOf(now - (29 - i) * DAY)).map((d) => ({ day: d, ms: byDay[d] ?? 0 }))
  const group = (k) => Object.values(times.reduce((m, r) => ((m[r[k] || '—'] = { name: r[k] || '—', ms: (m[r[k] || '—']?.ms ?? 0) + r.active_ms }), m), {})).sort((a, b) => b.ms - a.ms)
  return {
    ...out,
    daily,
    bySubject: group('subject'),
    byBook: group('book'),
    byLesson: group('lesson').slice(0, 15),
    lessons: ls.sort((a, b) => b.at - a.at),
    // للتقارير اليومية والأسبوعية والشهرية بحسب المادة والكتاب والدرس
    times: times.map((r) => ({ day: r.day, subject: r.subject, book: r.book, lesson: r.lesson, ms: r.active_ms })),
    recent: sessions.slice(0, 60).map((s) => ({ id: s.id, prev: s.prev_id, start: s.start, last: s.last, end: s.end, activeMs: s.active_ms, pausedMs: s.paused_ms, hidden: s.hidden, returns: s.returns, offline: s.offline, idle: s.idle, reason: s.end_reason, subject: s.subject, book: s.book, lesson: s.lesson, tasks: JSON.parse(s.tasks || '{}') })),
  }
}

export async function overview(request, env) {
  await requireUser(request, env, 'admin')
  const DB = await db(env)
  return { students: await Promise.all(STUDENTS.map((s) => summary(DB, s.id))), at: Date.now() }
}

export async function student(request, env, id) {
  await requireUser(request, env, 'admin')
  studentOr404(id)
  return summary(await db(env), id, true)
}

/** السجل الزمني مع الفلاتر: الطالب والتاريخ والمادة والكتاب والدرس */
export async function timeline(request, env, url) {
  await requireUser(request, env, 'admin')
  const p = url.searchParams
  const id = p.get('user') ?? ''
  studentOr404(id)
  const from = Number(p.get('from')) || Date.now() - DAY
  const to = Number(p.get('to')) || Date.now() + 60_000
  let sql = 'SELECT at, type, subject, book, lesson, detail, session_id, queued FROM events WHERE user_id = ? AND at >= ? AND at < ?'
  const args = [id, from, to]
  for (const k of ['subject', 'book', 'lesson'])
    if (p.get(k)) {
      sql += ` AND ${k} = ?`
      args.push(p.get(k))
    }
  return { events: await all(await db(env), sql + ' ORDER BY at ASC LIMIT 1000', ...args) }
}

/** بيانات الطالب للاطلاع فقط (الدفاتر والمحادثات والمخرجات) */
export async function data(request, env, id) {
  await requireUser(request, env, 'admin')
  studentOr404(id)
  return { docs: await readAll(await db(env), id) }
}

const num = (x, max) => (Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0)
export async function putPlan(request, env, id, b) {
  await requireUser(request, env, 'admin')
  studentOr404(id)
  const lessons = Array.isArray(b.lessons) ? b.lessons.slice(0, 60).filter((l) => typeof l?.key === 'string' && typeof l?.title === 'string').map((l) => ({ key: l.key.slice(0, 80), title: l.title.slice(0, 160), bookId: String(l.bookId ?? '').slice(0, 40), book: String(l.book ?? '').slice(0, 120), due: typeof l.due === 'string' ? l.due.slice(0, 10) : undefined })) : []
  const plan = {
    dailyMin: num(b.dailyMin, 960),
    weeklyMin: num(b.weeklyMin, 6720),
    weeklyQuizzes: num(b.weeklyQuizzes, 100),
    idleMin: Math.max(1, Math.min(num(b.idleMin, 30) || 2, 30)),
    reviewWeak: !!b.reviewWeak,
    examDate: typeof b.examDate === 'string' ? b.examDate.slice(0, 10) : undefined,
    reviewDates: Array.isArray(b.reviewDates) ? b.reviewDates.slice(0, 30).filter((r) => typeof r?.date === 'string').map((r) => ({ date: r.date.slice(0, 10), note: String(r.note ?? '').slice(0, 200) })) : [],
    note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
    lessons,
  }
  await run(await db(env), 'INSERT INTO plans (user_id, json, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated = excluded.updated', id, JSON.stringify(plan), Date.now())
  return { plan }
}
