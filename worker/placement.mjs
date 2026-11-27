/**
 * اختبار تحديد المستوى: بنك أسئلة لكل مادة يجهّزه المسؤول مسبقاً من حزم الدروس المتحقق منها (لا ذكاء اصطناعي أثناء الاختبار).
 *
 * الأمان:
 * - الإجابات الصحيحة والتفسيرات والمقاطع تبقى في الخادم حتى يسلّم الطالب كل اختبارات مواده (رحلة تحديد المستوى).
 * - لكل طالب نسخة مجمّدة من الاختبار (بترتيب خيارات خاص به) تُنشأ عند أول فتح، فتغيير البنك لاحقاً لا يغيّر اختباراً بدأ.
 * - التسليم مرة واحدة: UPDATE ... WHERE status = 'active'، فالتسليم المكرر لا يُحتسب مرتين ولا يغيّر النتيجة.
 * - المواد المقررة يحددها الخادم من معرّف الطالب، لا من الطلب.
 * - أسئلة البنك تُحجب من حزم الدروس التي يقرؤها الطالب حتى تظهر نتائجه، كي لا تُعرف الإجابة من الدرس.
 */
import * as auth from './auth.mjs'
import { all, db, one, run } from './db.mjs'
import { HttpError, isText } from './http.mjs'

export const SUBJECTS = ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء', 'العلوم الهندسية', 'اللغة العربية', 'اللغة الإنجليزية', 'التربية الإسلامية']
/** مسار كل حساب: أمنة (أحياء دون العلوم الهندسية)، محمد (العلوم الهندسية دون الأحياء). حسابا التجربة يحاكيانهما */
const TRACK = { amna: 'bio', mohamed: 'eng', qa_bio: 'bio', qa_eng: 'eng' }
const EXCLUDED = { bio: 'العلوم الهندسية', eng: 'الأحياء' }
const TESTER = new Set(['qa_bio', 'qa_eng'])
export const subjectsFor = (id) => SUBJECTS.filter((s) => s !== EXCLUDED[TRACK[id]])
/** المادة الممنوعة على هذا الحساب (للدروس وكل ما يقدمه الخادم) */
export const excludedOf = (u) => (u.role === 'student' ? EXCLUDED[TRACK[u.id]] : undefined)

const LIMIT = { items: 60, q: 700, opt: 300, why: 900, quote: 900, name: 200 }
const LEVELS = ['easy', 'medium', 'hard']
const GRACE = 90_000

async function need(env) {
  const DB = await db(env)
  if (!DB) throw new HttpError(503, 'no_db')
  return DB
}
const subjectOk = (s) => {
  if (!SUBJECTS.includes(s)) throw new HttpError(400, 'bad_request')
}
const str = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n

/** بند بنك صالح: سؤال موضوعي له خيارات، والإجابة أحدها، ومصدره (كتاب، درس، صفحة، مقطع) */
function validItem(x) {
  return x && typeof x === 'object' &&
    str(x.id, 60) && str(x.bookId, 80) && str(x.sectionId, 80) && str(x.book, LIMIT.name) && str(x.lesson, LIMIT.name) && (x.unit === undefined || str(x.unit, LIMIT.name)) &&
    Number.isInteger(x.page) && x.page > 0 && (x.printed === undefined || str(x.printed, 20)) && str(x.quote, LIMIT.quote) &&
    ['mcq', 'tf'].includes(x.type) && LEVELS.includes(x.level) && str(x.q, LIMIT.q) && str(x.why, LIMIT.why) &&
    Array.isArray(x.options) && x.options.length >= 2 && x.options.length <= 5 && x.options.every((o) => str(o, LIMIT.opt)) &&
    new Set(x.options).size === x.options.length && x.options.includes(x.answer) && (x.skill === undefined || str(x.skill, 40))
}

/** خلط بترتيب ثابت لكل طالب وسؤال */
function shuffled(arr, seed) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    const j = h % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function banks(DB, publishedOnly = true) {
  const rows = await all(DB, `SELECT subject, json, n, published, updated FROM placement_bank${publishedOnly ? ' WHERE published = 1' : ''}`)
  return new Map(rows.map((r) => [r.subject, { ...r, bank: JSON.parse(r.json) }]))
}

/** رحلة الطالب: المواد المقررة التي نُشر بنكها عند أول فتح؛ وما يُنشر بعد اكتمالها يصبح ملحقاً مستقلاً */
async function journeyOf(DB, uid, create) {
  let j = await one(DB, 'SELECT subjects, started, completed FROM placement_journey WHERE user_id = ?', uid)
  const pub = await banks(DB)
  const mine = subjectsFor(uid)
  if (!j && create) {
    const subjects = mine.filter((s) => pub.has(s))
    // الطالبان: لا تبدأ الرحلة حتى تُنشر بنوك كل موادهما، فلا تظهر نتيجة قبل اختبار كل المواد.
    // حسابا التجربة يبدآن بما نُشر لاختبار الموقع المنشور.
    const ready = TESTER.has(uid) ? subjects.length > 0 : subjects.length === mine.length
    if (ready) {
      await run(DB, 'INSERT OR IGNORE INTO placement_journey (user_id, subjects, started) VALUES (?, ?, ?)', uid, JSON.stringify(subjects), Date.now())
      j = await one(DB, 'SELECT subjects, started, completed FROM placement_journey WHERE user_id = ?', uid)
    }
  }
  const subjects = j ? JSON.parse(j.subjects) : []
  const extra = j ? mine.filter((s) => pub.has(s) && !subjects.includes(s)) : []
  const pending = mine.filter((s) => !pub.has(s))
  return { j, subjects, extra, pending, pub, mine }
}

/** المواد التي ظهرت نتائجها للطالب: الرحلة مكتملة، أو ملحق سُلّم */
async function revealedOf(DB, uid) {
  const j = await one(DB, 'SELECT subjects, completed FROM placement_journey WHERE user_id = ?', uid)
  const rows = await all(DB, "SELECT subject FROM placement WHERE user_id = ? AND status = 'submitted'", uid)
  const submitted = new Set(rows.map((r) => r.subject))
  const inJourney = j ? JSON.parse(j.subjects) : []
  return new Set([...submitted].filter((s) => (inJourney.includes(s) ? !!j.completed : true)))
}

const rowOf = (DB, uid, subject) => one(DB, 'SELECT * FROM placement WHERE user_id = ? AND subject = ?', uid, subject)
const publicItem = (x) => ({ id: x.id, q: x.q, options: x.options, type: x.type, level: x.level, ...(x.unit ? { unit: x.unit } : {}) })
const stateOf = (r) => (!r ? 'new' : r.status)

function summaryOf(subject, r, bank) {
  const frozen = r ? JSON.parse(r.json) : null
  const answers = r ? JSON.parse(r.answers || '{}') : {}
  return {
    subject,
    state: stateOf(r),
    n: frozen?.items.length ?? bank?.bank.items.length ?? 0,
    minutes: frozen?.minutes ?? bank?.bank.minutes ?? 0,
    answered: Object.values(answers).filter((v) => v !== null && v !== undefined).length,
    elapsed: r?.elapsed_ms ?? 0,
    ...(r?.submitted ? { submitted: r.submitted } : {}),
  }
}

/** النتيجة التفصيلية لمادة سُلّمت: لا تُعاد إلا بعد كشف النتائج */
function resultOf(subject, r) {
  const f = JSON.parse(r.json)
  const answers = JSON.parse(r.answers || '{}')
  const items = f.items.map((x) => {
    const given = Number.isInteger(answers[x.id]) ? answers[x.id] : null
    return {
      id: x.id, q: x.q, options: x.options, type: x.type, level: x.level, skill: x.skill, given, correct: x.ai,
      ok: given === x.ai, why: x.why, quote: x.quote, page: x.page, printed: x.printed, book: x.book, bookId: x.bookId, sectionId: x.sectionId, unit: x.unit, lesson: x.lesson,
    }
  })
  const correct = items.filter((x) => x.ok).length
  const blank = items.filter((x) => x.given === null).length
  return { subject, total: items.length, correct, wrong: items.length - correct - blank, blank, percent: Math.round((correct / Math.max(1, items.length)) * 100), elapsed: r.elapsed_ms, minutes: f.minutes, submitted: r.submitted, items }
}

/** حالة الرحلة للطالب؛ وتُنشأ عند أول دخول بعد نشر بنك لإحدى مواده */
export async function overview(request, env) {
  const u = await auth.requireUser(request, env, 'student')
  const DB = await need(env)
  const { j, subjects, extra, pending, pub } = await journeyOf(DB, u.id, true)
  const rows = new Map((await all(DB, 'SELECT * FROM placement WHERE user_id = ?', u.id)).map((r) => [r.subject, r]))
  const complete = !!j?.completed
  return {
    journey: j ? { started: j.started, completed: j.completed ?? null, subjects: subjects.map((s) => summaryOf(s, rows.get(s), pub.get(s))) } : null,
    extra: extra.map((s) => summaryOf(s, rows.get(s), pub.get(s))),
    pending,
    // النتائج: كل مواد الرحلة بعد اكتمالها، والملحقات المسلّمة
    results: [...(complete ? subjects : []), ...extra].filter((s) => rows.get(s)?.status === 'submitted').map((s) => resultOf(s, rows.get(s))),
  }
}

/** يفتح اختبار مادة (ويجمّد نسخته عند أول فتح)، دون الإجابات */
export async function start(request, env, subject) {
  const u = await auth.requireUser(request, env, 'student')
  subjectOk(subject)
  const DB = await need(env)
  const { subjects, extra, pub } = await journeyOf(DB, u.id, true)
  if (!subjects.includes(subject) && !extra.includes(subject)) throw new HttpError(403, 'forbidden')
  let r = await rowOf(DB, u.id, subject)
  if (!r) {
    const b = pub.get(subject)?.bank
    if (!b) throw new HttpError(404, 'not_found')
    // ترتيب الأسئلة كما في البنك (متوازن بين الوحدات والمستويات)، وترتيب الخيارات خاص بكل طالب
    const items = b.items.map((x) => {
      const options = x.type === 'tf' ? x.options : shuffled(x.options, `${u.id}:${x.id}`)
      return { ...x, options, ai: options.indexOf(x.answer) }
    })
    const now = Date.now()
    await run(DB, "INSERT OR IGNORE INTO placement (user_id, subject, status, json, answers, elapsed_ms, started, saved) VALUES (?, ?, 'active', ?, '{}', 0, ?, ?)", u.id, subject, JSON.stringify({ items, minutes: b.minutes, bankAt: pub.get(subject).updated }), now, now)
    r = await rowOf(DB, u.id, subject)
  }
  const f = JSON.parse(r.json)
  return { subject, state: r.status, minutes: f.minutes, elapsed: r.elapsed_ms, answers: JSON.parse(r.answers || '{}'), items: f.items.map(publicItem) }
}

function cleanAnswers(b, f) {
  const out = {}
  if (!b || typeof b !== 'object') return out
  for (const x of f.items) {
    const v = b[x.id]
    if (v === null) out[x.id] = null
    else if (Number.isInteger(v) && v >= 0 && v < x.options.length) out[x.id] = v
  }
  return out
}
/** الوقت المنقضي لا يتقدم أكثر من الوقت الفعلي منذ آخر حفظ (لا يُخدع العداد بإرسال قيمة كبيرة أو صغيرة) */
const elapsedOf = (r, claimed, now) => Math.max(r.elapsed_ms, Math.min(Number.isFinite(claimed) ? Math.round(claimed) : 0, r.elapsed_ms + (now - r.saved) + 5000))

/** حفظ الإجابات أثناء الاختبار (يُستأنف بعده من أي جهاز) */
export async function save(request, env, subject, b) {
  const u = await auth.requireUser(request, env, 'student')
  subjectOk(subject)
  const DB = await need(env)
  const r = await rowOf(DB, u.id, subject)
  if (!r) throw new HttpError(404, 'not_found')
  if (r.status !== 'active') throw new HttpError(409, 'submitted')
  const f = JSON.parse(r.json)
  const now = Date.now()
  const elapsed = elapsedOf(r, Number(b?.elapsed), now)
  if (r.elapsed_ms > f.minutes * 60_000 + GRACE) throw new HttpError(409, 'time_up')
  const answers = { ...JSON.parse(r.answers || '{}'), ...cleanAnswers(b?.answers, f) }
  await run(DB, "UPDATE placement SET answers = ?, elapsed_ms = ?, saved = ? WHERE user_id = ? AND subject = ? AND status = 'active'", JSON.stringify(answers), elapsed, now, u.id, subject)
  return { ok: true, elapsed }
}

/** التسليم النهائي لمادة: مرة واحدة، ثم لا تغيير. يكتمل به الرحلة إن سُلّمت كل موادها */
export async function submit(request, env, subject, b) {
  const u = await auth.requireUser(request, env, 'student')
  subjectOk(subject)
  const DB = await need(env)
  const r = await rowOf(DB, u.id, subject)
  if (!r) throw new HttpError(404, 'not_found')
  if (r.status === 'active') {
    const f = JSON.parse(r.json)
    const now = Date.now()
    const late = r.elapsed_ms > f.minutes * 60_000 + GRACE
    const answers = late ? JSON.parse(r.answers || '{}') : { ...JSON.parse(r.answers || '{}'), ...cleanAnswers(b?.answers, f) }
    const score = f.items.filter((x) => answers[x.id] === x.ai).length
    await run(DB, "UPDATE placement SET status = 'submitted', answers = ?, elapsed_ms = ?, score = ?, total = ?, submitted = ? WHERE user_id = ? AND subject = ? AND status = 'active'",
      JSON.stringify(answers), late ? r.elapsed_ms : elapsedOf(r, Number(b?.elapsed), now), score, f.items.length, now, u.id, subject)
  }
  const j = await one(DB, 'SELECT subjects, completed FROM placement_journey WHERE user_id = ?', u.id)
  if (j && !j.completed) {
    const subjects = JSON.parse(j.subjects)
    const done = await all(DB, "SELECT subject FROM placement WHERE user_id = ? AND status = 'submitted'", u.id)
    if (subjects.every((s) => done.some((d) => d.subject === s))) await run(DB, 'UPDATE placement_journey SET completed = ? WHERE user_id = ? AND completed IS NULL', Date.now(), u.id)
  }
  return { ok: true }
}

/** أسئلة البنك المحجوبة عن هذا الطالب في حزم كتاب (حتى تظهر نتائجه) */
export async function heldFor(DB, u, bookId) {
  if (u.role !== 'student') return null
  const rows = await all(DB, 'SELECT subject, json FROM placement_bank WHERE published = 1')
  if (!rows.length) return null
  const shown = await revealedOf(DB, u.id)
  const held = new Set()
  for (const r of rows) if (!shown.has(r.subject)) for (const x of JSON.parse(r.json).items) if (!bookId || x.bookId === bookId) held.add(x.q)
  return held
}
/** بصمة قصيرة لما يُحجب: تتغير عند نشر بنك أو كشف نتيجة، فيعيد المتصفح تنزيل الحزم */
export async function holdKey(DB, u) {
  if (u.role !== 'student') return ''
  const rows = await all(DB, 'SELECT subject, updated FROM placement_bank WHERE published = 1')
  if (!rows.length) return ''
  const shown = await revealedOf(DB, u.id)
  return rows.filter((r) => !shown.has(r.subject)).map((r) => `${SUBJECTS.indexOf(r.subject)}.${r.updated.toString(36)}`).sort().join('-') || 'open'
}

// ===== المسؤول =====
export async function putBank(request, env, subject, b) {
  await auth.requireUser(request, env, 'admin')
  subjectOk(subject)
  const DB = await need(env)
  const bank = b?.bank
  if (!bank || !Array.isArray(bank.items) || !bank.items.length || bank.items.length > LIMIT.items || !bank.items.every(validItem) || new Set(bank.items.map((x) => x.id)).size !== bank.items.length) throw new HttpError(400, 'bad_request')
  const minutes = Number(bank.minutes)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new HttpError(400, 'bad_request')
  const clean = {
    subject, minutes, built: Date.now(),
    coverage: bank.coverage && typeof bank.coverage === 'object' ? { units: Number(bank.coverage.units) || 0, covered: Number(bank.coverage.covered) || 0, lessons: Number(bank.coverage.lessons) || 0 } : null,
    review: isText(bank.review, 400) ? bank.review : '',
    items: bank.items.map((x) => ({ id: x.id, bookId: x.bookId, sectionId: x.sectionId, book: x.book, unit: x.unit, lesson: x.lesson, page: x.page, printed: x.printed, quote: x.quote, type: x.type, level: x.level, skill: x.skill, q: x.q, options: x.options, answer: x.answer, why: x.why })),
  }
  const json = JSON.stringify(clean)
  if (json.length > 400_000) throw new HttpError(413, 'too_large')
  await run(DB, 'INSERT INTO placement_bank (subject, json, n, published, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET json = excluded.json, n = excluded.n, published = excluded.published, updated = excluded.updated',
    subject, json, clean.items.length, b.publish ? 1 : 0, Date.now())
  return { ok: true, n: clean.items.length }
}

const PEOPLE = [...auth.STUDENTS.map((s) => s.id), 'qa_bio', 'qa_eng']
export async function adminOverview(request, env) {
  await auth.requireUser(request, env, 'admin')
  const DB = await need(env)
  const b = await banks(DB, false)
  const people = []
  for (const id of PEOPLE) {
    const j = await one(DB, 'SELECT subjects, started, completed FROM placement_journey WHERE user_id = ?', id)
    const rows = await all(DB, 'SELECT subject, status, score, total, elapsed_ms, started, submitted FROM placement WHERE user_id = ?', id)
    people.push({ id, subjects: subjectsFor(id), journey: j ? { subjects: JSON.parse(j.subjects), started: j.started, completed: j.completed ?? null } : null, tests: rows })
  }
  return {
    banks: SUBJECTS.map((s) => {
      const x = b.get(s)
      return x ? { subject: s, n: x.n, published: !!x.published, updated: x.updated, minutes: x.bank.minutes, coverage: x.bank.coverage, review: x.bank.review } : { subject: s, n: 0, published: false }
    }),
    people,
  }
}
/** المسؤول يطّلع على النتائج التفصيلية لطالب (ولو قبل الكشف له) */
export async function adminResults(request, env, id) {
  await auth.requireUser(request, env, 'admin')
  if (!PEOPLE.includes(id)) throw new HttpError(404, 'not_found')
  const DB = await need(env)
  const rows = await all(DB, "SELECT * FROM placement WHERE user_id = ? AND status = 'submitted'", id)
  return { results: rows.map((r) => resultOf(r.subject, r)) }
}
/** إعادة تعيين محمية: بتأكيد صريح، وتُحفظ المحاولة السابقة في الأرشيف ولا تُحذف */
export async function adminReset(request, env, b) {
  await auth.requireUser(request, env, 'admin')
  const id = b?.userId
  if (!PEOPLE.includes(id) || b?.confirm !== `إعادة ${id}`) throw new HttpError(400, 'bad_request')
  if (b.subject !== undefined) subjectOk(b.subject)
  const DB = await need(env)
  const rows = await all(DB, 'SELECT * FROM placement WHERE user_id = ?' + (b.subject ? ' AND subject = ?' : ''), ...(b.subject ? [id, b.subject] : [id]))
  const j = await one(DB, 'SELECT * FROM placement_journey WHERE user_id = ?', id)
  await DB.batch([
    DB.prepare('INSERT INTO placement_archive (user_id, at, json) VALUES (?, ?, ?)').bind(id, Date.now(), JSON.stringify({ journey: j, rows, subject: b.subject ?? null })),
    ...(b.subject
      ? [DB.prepare('DELETE FROM placement WHERE user_id = ? AND subject = ?').bind(id, b.subject), DB.prepare('UPDATE placement_journey SET completed = NULL WHERE user_id = ?').bind(id)]
      : [DB.prepare('DELETE FROM placement WHERE user_id = ?').bind(id), DB.prepare('DELETE FROM placement_journey WHERE user_id = ?').bind(id)]),
  ])
  return { ok: true, archived: rows.length }
}
