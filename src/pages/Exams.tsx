import { useMemo, useState } from 'react'
import { Archive, BookOpenCheck, ClipboardList, Database, LoaderCircle, Play, Shuffle, Target, TriangleAlert } from 'lucide-react'
import { ExamRunner } from '../components/exams/ExamRunner'
import { normalize } from '../lib/arabic'
import { toolData, usePacks } from '../services/study/lessonPack'
import { num } from '../lib/format'
import { notebookFor } from '../lib/study'
import { Link } from '../router'
import { useDocs } from '../services/books/process'
import { buildExam, coverage, EXAM_SOURCES, EXTERNAL_PAPERS, externalExam, GUIDE_2025, lessonOf, type ExamSource } from '../services/study/exams'
import { LEVEL_ASK, makeQuiz, QUESTION_TYPES, StudyError } from '../services/study/generate'
import { Unavailable } from '../services/ai/manager'
import { actions, uid, useData } from '../store/store'
import { toast } from '../store/toast'
import type { ExamMeta, QuestionType, QuizQuestion, StudyOutput } from '../types'

type QuizOutput = StudyOutput & { data: { kind: 'quiz' } }
const isQuiz = (o: StudyOutput): o is QuizOutput => o.data.kind === 'quiz'
const LEVEL: Record<keyof typeof LEVEL_ASK, string> = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' }

function save(title: string, bookId: string, questions: QuizQuestion[], meta: ExamMeta): QuizOutput {
  const o: QuizOutput = { id: uid(), notebookId: notebookFor(bookId), title, createdAt: Date.now(), data: { kind: 'quiz', questions, meta } }
  actions.addOutput(o)
  return o
}

/** امتحانات الشهادة: ما وُجد فعلاً في الكتب، وما ينقص */
function ExamsTab({ run }: { run: (o: QuizOutput) => void }) {
  const docs = useDocs()
  const data = useData()
  const [busy, setBusy] = useState('')
  const [minutes, setMinutes] = useState<Record<string, number>>({})
  const start = async (s: ExamSource) => {
    setBusy(s.id)
    try {
      const questions = await buildExam(s)
      if (!questions.length) return toast('لم تُقرأ أسئلة من هذه الصفحات.')
      const m = minutes[s.id] || s.minutes
      run(save(`امتحان: ${s.title}`, s.bookId, questions, { mode: 'exam', sourceId: s.id, subject: s.subject, minutes: m || undefined, estimated: !s.minutes && !!m, marks: s.marks }))
    } catch {
      toast('نزّل هذا الكتاب من المكتبة أولاً.')
    } finally {
      setBusy('')
    }
  }
  const attempts = (id: string) => data.attempts.filter((a) => data.outputs.some((o) => o.id === a.outputId && isQuiz(o) && o.data.meta?.sourceId === id))
  return (
    <>
      <p className="insight">
        <TriangleAlert aria-hidden="true" /> امتحانات الشهادة المتوفرة: امتحان أبريل 2020 لست مواد، منشوراً على موقع حكومي سوداني، ويُفتح من مصدره. لا نموذج إجابة رسمياً منشوراً لأي سنة، ولا امتحانات سنوات أخرى من مصدر رسمي. باقي المصادر نماذج وأسئلة بنمط الشهادة من الكتب، وكل منها موسوم بمصدره.
      </p>
      <section className="panel">
        <h3 className="mini-h">ما يتوفر لكل مادة</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>المادة</th>
                <th>امتحانات سابقة</th>
                <th>نماذج امتحان</th>
                <th>أسئلة بنمط الشهادة</th>
                <th>نماذج إجابة رسمية</th>
                <th>المقرر وهيكل الامتحان 2025</th>
              </tr>
            </thead>
            <tbody>
              {coverage().map((c) => (
                <tr key={c.subject}>
                  <td>{c.subject}</td>
                  <td>{num(c.past)}</td>
                  <td>{num(c.model)}</td>
                  <td>{num(c.style)}</td>
                  <td>{num(c.officialKeys)}</td>
                  <td>{c.guide ? <a href={`${GUIDE_2025.url}#page=${c.guide}`} target="_blank" rel="noreferrer">الدليل الرسمي ص {num(c.guide)}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <h3 className="mini-h">امتحانات سابقة من مصدر حكومي</h3>
      <div className="admin-grid">
        {EXTERNAL_PAPERS.map((x) => (
          <article key={x.id} className="panel exam-source">
            <h3 className="mini-h">{x.title}</h3>
            <p className={x.kind === 'past' ? 'pill ok' : 'pill'}>{x.kind === 'past' ? 'امتحان شهادة' : 'امتحان تجريبي'} · {x.issuer}</p>
            <p className="muted small">
              {num(x.pages)} صفحات · الزمن {num(x.minutes / 60)} ساعات (مطبوع على الورقة) · {x.note}
            </p>
            <div className="btn-row">
              <a className="btn" href={x.url} target="_blank" rel="noreferrer">
                افتح الورقة
              </a>
              <button className="btn btn-primary" onClick={() => run(save(x.title, data.books.find((b) => b.subject === x.subject)?.id ?? data.books[0]?.id ?? '', externalExam(x), { mode: 'exam', sourceId: x.id, subject: x.subject, minutes: x.minutes, estimated: false }))}>
                <Play aria-hidden="true" /> حلّ بزمن الامتحان
              </button>
            </div>
          </article>
        ))}
      </div>
      <h3 className="mini-h">نماذج وأسئلة بنمط الشهادة من الكتب</h3>
      <div className="admin-grid">
        {EXAM_SOURCES.map((s) => {
          const ready = !!docs[s.bookId]?.chunkCount
          const tries = attempts(s.id)
          return (
            <article key={s.id} className="panel exam-source">
              <h3 className="mini-h">
                <bdi>{s.title}</bdi>
              </h3>
              <p className="muted small">
                {s.subject} · {s.book} · ص {num(s.from)}{s.to > s.from ? `–${num(s.to)}` : ''}
              </p>
              <p className="pill">{s.origin}</p>
              {s.note && <p className="muted small">{s.note}</p>}
              {tries.length > 0 && (
                <p className="small">
                  محاولاتك: {num(tries.length)} · آخرها {num(tries[0].score)} من {num(tries[0].total)}
                </p>
              )}
              {ready ? (
                <div className="btn-row">
                  <label className="field exam-min">
                    <span>زمن تقديري بالدقائق (اختياري)</span>
                    <input type="number" min={0} max={240} value={minutes[s.id] ?? ''} onChange={(e) => setMinutes({ ...minutes, [s.id]: Number(e.target.value) })} />
                  </label>
                  <button className="btn btn-primary" disabled={!!busy} onClick={() => void start(s)}>
                    {busy === s.id ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />} ابدأ الحل
                  </button>
                </div>
              ) : (
                <p className="muted small">
                  نزّل «{s.book}» من <Link to="/library">المكتبة</Link> أولاً.
                </p>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}

/** أوراق عمل من دروس الكتاب، أو من نقاط ضعف الطالب */
function WorksheetsTab({ run }: { run: (o: QuizOutput) => void }) {
  const data = useData()
  const docs = useDocs()
  const books = data.books.filter((b) => docs[b.id]?.chunkCount)
  const [bookId, setBookId] = useState(books[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [types, setTypes] = useState<QuestionType[]>(['mcq', 'tf', 'fill', 'short', 'reason'])
  const [count, setCount] = useState(10)
  const [level, setLevel] = useState<keyof typeof LEVEL_ASK>('medium')
  const [busy, setBusy] = useState(false)
  const sections = docs[bookId]?.sections ?? []
  const book = books.find((b) => b.id === bookId)
  const weak = data.mistakes.filter((m) => !m.resolved)

  const make = async (scopeBook: string, ranges: { bookId: string; from: number; to: number }[], title: string, lessons: string[]) => {
    setBusy(true)
    try {
      const out = await makeQuiz({ bookIds: [scopeBook], ...(ranges.length ? { ranges } : {}) }, types, count, new AbortController().signal, level)
      if (out.kind !== 'quiz') return
      run(save(title, scopeBook, out.questions, { mode: 'worksheet', subject: data.books.find((b) => b.id === scopeBook)?.subject, minutes: count * 2, estimated: true, marks: out.questions.length, level, lessons }))
    } catch (e) {
      toast(e instanceof StudyError ? e.message : e instanceof Unavailable ? 'إعداد ورقة العمل يحتاج إلى خدمة الذكاء الاصطناعي، وهي غير متاحة الآن.' : 'تعذّر إعداد ورقة العمل.')
    } finally {
      setBusy(false)
    }
  }
  const fromWeak = () => {
    // الكتاب الذي فيه أكثر الأخطاء، ودروس تلك الأخطاء
    const byBook = new Map<string, typeof weak>()
    for (const m of weak) byBook.set(m.bookId, [...(byBook.get(m.bookId) ?? []), m])
    const [bid, list] = [...byBook].sort((a, b) => b[1].length - a[1].length)[0]
    const lessons = [...new Map(list.map((m) => lessonOf(bid, m.page)).filter(Boolean).map((s) => [s!.id, s!])).values()]
    void make(bid, lessons.map((s) => ({ bookId: bid, from: s.page, to: s.endPage })), `ورقة عمل من نقاط ضعفي: ${data.books.find((b) => b.id === bid)?.title ?? ''}`, lessons.map((s) => s.title))
  }
  const sheets = data.outputs.filter((o): o is QuizOutput => isQuiz(o) && o.data.meta?.mode === 'worksheet')
  const ready = useReadyQuestions().filter((r) => r.kind === 'worksheet')
  const readyBooks = [...new Map(ready.map((r) => [r.bookId, r.q.cite.bookTitle])).entries()]
  const [rb, setRb] = useState('')
  const rbook = rb || readyBooks[0]?.[0] || ''
  const groups = [...ready.filter((r) => r.bookId === rbook).reduce((m, r) => m.set(r.unit || r.lesson, [...(m.get(r.unit || r.lesson) ?? []), r]), new Map<string, typeof ready>())]
  const openSheet = (title: string, list: typeof ready) =>
    run(save(title, list[0].bookId, list.map((r) => r.q), { mode: 'worksheet', subject: list[0].subject, minutes: list.length * 3, estimated: true, marks: list.length, lessons: [...new Set(list.map((r) => r.lesson))] }))
  return (
    <>
      {ready.length > 0 && (
        <section className="panel form" aria-labelledby="ready-ws">
          <h3 className="mini-h" id="ready-ws">أوراق عمل جاهزة</h3>
          <p className="muted">أوراق أعدّها رفيق مسبقاً من صفحات الكتاب، بنموذج إجابة. تُطبع من داخل الورقة.</p>
          <label className="field">
            <span>الكتاب</span>
            <select className="input" value={rbook} onChange={(e) => setRb(e.target.value)}>
              {readyBooks.map(([id, t]) => (
                <option key={id} value={id}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <ul className="ready-sheets">
            {groups.map(([unitName, list]) => {
              const byLesson = [...new Map(list.map((r) => [r.lesson, list.filter((x) => x.lesson === r.lesson)])).entries()]
              return (
                <li key={unitName}>
                  <div className="sheet-unit">
                    <strong>{unitName}</strong>
                    {byLesson.length > 1 && (
                      <button className="btn btn-sm" onClick={() => openSheet(`ورقة مراجعة الوحدة: ${unitName}`, list)}>
                        ورقة الوحدة ({num(list.length)})
                      </button>
                    )}
                  </div>
                  <div className="chips">
                    {byLesson.map(([lessonName, ls]) => (
                      <button key={lessonName} className="chip" onClick={() => openSheet(`ورقة عمل: ${lessonName}`, ls)}>
                        {lessonName} <small className="muted">{num(ls.length)}</small>
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section className="panel form">
        <h3 className="mini-h">ورقة عمل جديدة</h3>
        {!books.length ? (
          <p className="muted">
            نزّل كتاباً من <Link to="/library">المكتبة</Link> أولاً.
          </p>
        ) : (
          <>
            <div className="grid-2">
              <label className="field">
                <span>الكتاب</span>
                <select className="input" value={bookId} onChange={(e) => (setBookId(e.target.value), setPicked([]))}>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>المستوى</span>
                <select className="input" value={level} onChange={(e) => setLevel(e.target.value as keyof typeof LEVEL_ASK)}>
                  {Object.entries(LEVEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>عدد الأسئلة</span>
                <input className="input" type="number" min={3} max={30} value={count} onChange={(e) => setCount(Math.max(3, Math.min(30, Number(e.target.value) || 10)))} />
              </label>
            </div>
            <fieldset className="field">
              <legend>الدروس (لا شيء = الكتاب كاملاً)</legend>
              <div className="exam-lessons">
                {sections.map((s) => (
                  <label key={s.id} className="check-row" data-level={s.level}>
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /> <bdi>{s.title}</bdi>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="field">
              <legend>أنواع الأسئلة</legend>
              <div className="chips">
                {(Object.keys(QUESTION_TYPES) as QuestionType[]).map((t) => (
                  <label key={t} className="check-row">
                    <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} /> {QUESTION_TYPES[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted small">
              الزمن المقترح {num(count * 2)} دقيقة، والدرجة المقترحة {num(count)} (سؤال لكل درجة). الأسئلة من إعداد رفيق اعتماداً على الكتاب، وليست أسئلة امتحان حقيقية.
            </p>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                disabled={busy || !types.length || !book}
                onClick={() => {
                  const ss = sections.filter((s) => picked.includes(s.id))
                  void make(bookId, ss.map((s) => ({ bookId, from: s.page, to: s.endPage })), `ورقة عمل: ${book!.title}${ss.length ? ` — ${ss.map((s) => s.title).join('، ').slice(0, 80)}` : ''}`, ss.map((s) => s.title))
                }}
              >
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <ClipboardList aria-hidden="true" />} أعدّ ورقة العمل
              </button>
              <button className="btn" disabled={busy || !weak.length || !types.length} onClick={fromWeak} title={weak.length ? '' : 'لا أخطاء مسجلة بعد'}>
                <Target aria-hidden="true" /> ورقة من نقاط ضعفي ({num(weak.length)})
              </button>
            </div>
          </>
        )}
      </section>
      {!!sheets.length && (
        <section className="panel">
          <h3 className="mini-h">أوراقي السابقة</h3>
          <ul className="admin-list">
            {sheets.map((o) => {
              const last = data.attempts.find((a) => a.outputId === o.id)
              return (
                <li key={o.id}>
                  <bdi className="grow">{o.title}</bdi>
                  <small className="muted">
                    {num(o.data.questions.length)} سؤالاً · {LEVEL[o.data.meta?.level ?? 'medium']}
                    {last ? ` · آخر نتيجة ${num(last.score)}/${num(last.total)}` : ''}
                  </small>
                  <button className="btn btn-sm" onClick={() => run(o)}>
                    حلّها
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}

/** بنك الأسئلة: كل أسئلة الطالب من الاختبارات والأوراق والمصادر، دون تكرار */
/** أسئلة الدروس الجاهزة بمادتها وكتابها ووحدتها ودرسها ومستواها */
function useReadyQuestions() {
  const { cache } = usePacks()
  const docs = useDocs()
  return useMemo(() => {
    const out: { q: QuizQuestion; subject: string; bookId: string; unit: string; lesson: string; level: string; kind: 'quiz' | 'worksheet' }[] = []
    for (const [bookId, e] of Object.entries(cache))
      for (const p of Object.values(e.lessons)) {
        if (p.status === 'hidden') continue
        const sections = docs[bookId]?.sections ?? []
        const unit = [...sections].reverse().find((x) => x.level === 1 && x.page <= p.from)?.title ?? ''
        for (const lv of ['easy', 'medium', 'hard'] as const) {
          const d = toolData(p, `quiz-${lv}`)
          if (d.kind === 'quiz') for (const q of d.questions) out.push({ q, subject: p.subject, bookId, unit, lesson: p.title, level: lv, kind: 'quiz' })
        }
        const w = toolData(p, 'worksheet')
        if (w.kind === 'quiz') for (const q of w.questions) out.push({ q, subject: p.subject, bookId, unit, lesson: p.title, level: 'medium', kind: 'worksheet' })
      }
    return out
  }, [cache, docs])
}
const LEVELS_AR: Record<string, string> = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' }

function BankTab({ run }: { run: (o: QuizOutput) => void }) {
  const data = useData()
  const ready = useReadyQuestions()
  const [subject, setSubject] = useState('')
  const [unit, setUnit] = useState('')
  const [lesson, setLesson] = useState('')
  const [level, setLevel] = useState('')
  const [book, setBook] = useState('')
  const [type, setType] = useState('')
  const [origin, setOrigin] = useState('')
  const [count, setCount] = useState(10)
  const [minutes, setMinutes] = useState(20)
  type Entry = { q: QuizQuestion; subject?: string; unit?: string; lesson?: string; level?: string }
  const bank = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    const add = (e: Entry) => {
      const k = normalize(e.q.q)
      if (e.q.pageTask || seen.has(k)) return
      seen.add(k)
      out.push(e)
    }
    for (const r of ready) add(r)
    for (const o of data.outputs) if (isQuiz(o)) for (const q of o.data.questions) add({ q, subject: data.books.find((b) => b.id === q.cite.bookId)?.subject })
    return out
  }, [data.outputs, data.books, ready])
  const list = bank
    .filter((e) => (!subject || e.subject === subject) && (!book || e.q.cite.bookId === book) && (!unit || e.unit === unit) && (!lesson || e.lesson === lesson) && (!level || e.level === level))
    .filter((e) => (!type || e.q.type === type) && (!origin || (origin === 'rafeeq' ? !e.q.origin || e.q.origin.includes('رفيق') : !!e.q.origin && !e.q.origin.includes('رفيق'))))
    .map((e) => e.q)
  const subjects = [...new Set(bank.map((e) => e.subject).filter((x): x is string => !!x))]
  const books = [...new Map(bank.filter((e) => !subject || e.subject === subject).map((e) => [e.q.cite.bookId, e.q.cite.bookTitle])).entries()]
  const units = [...new Set(bank.filter((e) => e.q.cite.bookId === book && e.unit).map((e) => e.unit!))]
  const lessons = [...new Set(bank.filter((e) => e.q.cite.bookId === book && (!unit || e.unit === unit) && e.lesson).map((e) => e.lesson!))]
  const mixed = () => {
    // دون تكرار داخل الاختبار، وبترتيب عشوائي
    const pick = [...list].map((q) => ({ q, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, count).map((x) => x.q)
    if (!pick.length) return
    const scope = lesson || unit || books.find(([id]) => id === book)?.[1] || subject
    run(save(`اختبار ${scope ? `«${scope}»` : 'مختلط'}${level ? ` (${LEVELS_AR[level]})` : ''}: ${num(pick.length)} سؤالاً`, pick[0].cite.bookId, pick, { mode: 'mixed', minutes, estimated: true, marks: pick.length, ...(level ? { level: level as 'easy' | 'medium' | 'hard' } : {}) }))
  }
  return (
    <section className="panel form">
      <p className="muted">
        في البنك {num(bank.length)} سؤالاً مختلفاً: أسئلة الدروس الجاهزة، واختباراتك وأوراق عملك، ومصادر الامتحانات. كل سؤال بمصدره وصفحته، والأسئلة من إعداد رفيق ليست أسئلة امتحان رسمية.
      </p>
      <div className="grid-2">
        <label className="field">
          <span>المادة</span>
          <select className="input" value={subject} onChange={(e) => (setSubject(e.target.value), setBook(''), setUnit(''), setLesson(''))}>
            <option value="">الكل</option>
            {subjects.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>الكتاب</span>
          <select className="input" value={book} onChange={(e) => (setBook(e.target.value), setUnit(''), setLesson(''))}>
            <option value="">الكل</option>
            {books.map(([id, t]) => (
              <option key={id} value={id}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {book && units.length > 0 && (
          <label className="field">
            <span>الوحدة</span>
            <select className="input" value={unit} onChange={(e) => (setUnit(e.target.value), setLesson(''))}>
              <option value="">كل الوحدات</option>
              {units.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        )}
        {book && lessons.length > 0 && (
          <label className="field">
            <span>الدرس</span>
            <select className="input" value={lesson} onChange={(e) => setLesson(e.target.value)}>
              <option value="">كل الدروس</option>
              {lessons.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>المستوى</span>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(LEVELS_AR).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>النوع</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(QUESTION_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>المصدر</span>
          <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">الكل</option>
            <option value="rafeeq">من إعداد رفيق</option>
            <option value="source">من مصادر الامتحانات</option>
          </select>
        </label>
        <label className="field">
          <span>عدد الأسئلة</span>
          <input className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 10)))} />
        </label>
        <label className="field">
          <span>الزمن (دقائق)</span>
          <input className="input" type="number" min={0} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
      <p className="small">المطابق للتصفية: {num(list.length)} سؤالاً.</p>
      <button className="btn btn-primary" disabled={!list.length} onClick={mixed}>
        <Shuffle aria-hidden="true" /> اختبار مختلط
      </button>
      {!bank.length && <p className="muted">البنك فارغ: أنشئ اختباراً أو ورقة عمل، أو حلّ أحد مصادر الامتحانات.</p>}
    </section>
  )
}

/** خلط ثابت العدد دون تكرار */
const shuffle = <T,>(a: T[]) => a.map((x) => ({ x, r: Math.random() })).sort((p, q) => p.r - q.r).map((p) => p.x)
/** يأخذ من كل مجموعة حتى n بالتناوب، فلا يطغى درس على غيره */
function spread<T>(groups: T[][], n: number): T[] {
  const gs = groups.map((g) => shuffle(g))
  const out: T[] = []
  for (let i = 0; out.length < n && gs.some((g) => i < g.length); i++) for (const g of gs) if (i < g.length && out.length < n) out.push(g[i])
  return out
}

/** التقييمات من أسئلة الدروس الجاهزة: لا تحتاج خدمة الذكاء الاصطناعي */
function AssessTab({ run }: { run: (o: QuizOutput) => void }) {
  const data = useData()
  const ready = useReadyQuestions().filter((r) => r.kind === 'quiz' && !r.q.flag)
  const subjects = [...new Set(ready.map((r) => r.subject))]
  const [subject, setSubject] = useState('')
  const sub = subject || subjects[0] || ''
  const inSub = ready.filter((r) => r.subject === sub)
  const units = [...new Map(inSub.map((r) => [`${r.bookId}|${r.unit || r.lesson}`, { book: r.q.cite.bookTitle, unit: r.unit || r.lesson }])).entries()]
  const [unitKey, setUnitKey] = useState('')
  const uk = unitKey && units.some(([k]) => k === unitKey) ? unitKey : units[0]?.[0] ?? ''
  const byLesson = (list: typeof ready) => [...list.reduce((m, r) => m.set(r.lesson, [...(m.get(r.lesson) ?? []), r]), new Map<string, typeof ready>()).values()]
  const start = (title: string, list: typeof ready, minutes: number, note: string) => {
    if (!list.length) return toast('لا أسئلة جاهزة كافية لهذا التقييم بعد.')
    run(save(title, list[0].bookId, list.map((r) => r.q), { mode: 'mixed', subject: list[0].subject, minutes, estimated: true, marks: list.length, lessons: [...new Set(list.map((r) => r.lesson))] }))
    toast(note)
  }
  // تشخيصي: سؤال سهل وآخر متوسط من كل درس (حتى ٣٠)، ليعرف الطالب من أين يبدأ
  const placement = () => {
    const groups = byLesson(inSub).map((g) => [...shuffle(g.filter((r) => r.level === 'easy')).slice(0, 1), ...shuffle(g.filter((r) => r.level === 'medium')).slice(0, 1)])
    const list = spread(groups, 30)
    start(`اختبار تشخيصي: ${sub}`, list, Math.round(list.length * 1.5), 'بعد الحل ستظهر الدروس التي تحتاج إليها أكثر في نتيجتك.')
  }
  const unit = () => {
    const u = units.find(([k]) => k === uk)?.[1]
    const list = spread(byLesson(inSub.filter((r) => `${r.bookId}|${r.unit || r.lesson}` === uk && r.level !== 'easy')), 20)
    start(`اختبار وحدة: ${u?.unit ?? ''}`, list, list.length * 2, 'اختبار الوحدة من الأسئلة المتوسطة والصعبة في دروسها.')
  }
  // محاكاة زمنية: أسئلة من كل الوحدات بكل المستويات وبزمن محدد؛ ليست امتحاناً رسمياً
  const simulation = () => {
    const groups = [...inSub.reduce((m, r) => m.set(r.unit || r.lesson, [...(m.get(r.unit || r.lesson) ?? []), r]), new Map<string, typeof ready>()).values()]
    const list = spread(groups, 40)
    start(`محاكاة امتحان: ${sub}`, list, Math.max(30, Math.round(list.length * 2.25)), 'محاكاة بزمن محدد من أسئلة رفيق؛ ليست امتحاناً رسمياً ولا من سنة سابقة.')
  }
  // علاجي: أسئلة جديدة من الدروس التي أخطأ فيها الطالب ولم يتجاوز خطأه
  const weakLessons = new Set(data.mistakes.filter((m) => !m.resolved).map((m) => lessonOf(m.bookId, m.page)?.title).filter((x): x is string => !!x))
  const remedial = () => {
    const seen = new Set(data.mistakes.map((m) => normalize(m.q)))
    const list = spread(byLesson(ready.filter((r) => weakLessons.has(r.lesson) && !seen.has(normalize(r.q.q)))), 15)
    start('اختبار علاجي من نقاط ضعفي', list, list.length * 2, 'أسئلة جديدة من الدروس التي أخطأت فيها، لا الأسئلة نفسها.')
  }
  if (!ready.length) return <p className="muted panel">التقييمات تُبنى من المحتوى الجاهز للدروس، وهو قيد الإعداد.</p>
  return (
    <section className="panel form" aria-labelledby="assess-h">
      <h3 className="mini-h" id="assess-h">التقييمات</h3>
      <p className="muted">تُبنى من أسئلة الدروس الجاهزة (بنموذج إجابة ومصدر لكل سؤال)، دون انتظار أي خدمة. الأسئلة التي عليها «تحتاج مراجعة» لا تدخلها. الأزمنة تقديرية.</p>
      <label className="field">
        <span>المادة</span>
        <select className="input" value={sub} onChange={(e) => (setSubject(e.target.value), setUnitKey(''))}>
          {subjects.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <div className="assess-grid">
        <article className="assess">
          <h4>تشخيصي</h4>
          <p className="muted small">سؤالان من كل درس جاهز، لتعرف أين تقف قبل أن تخطط.</p>
          <button className="btn btn-primary" onClick={placement}>
            <Play aria-hidden="true" /> ابدأ
          </button>
        </article>
        <article className="assess">
          <h4>اختبار وحدة</h4>
          <select className="input" aria-label="الوحدة" value={uk} onChange={(e) => setUnitKey(e.target.value)}>
            {units.map(([k, u]) => (
              <option key={k} value={k}>
                {u.unit} ({u.book})
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={unit}>
            <Play aria-hidden="true" /> ابدأ
          </button>
        </article>
        <article className="assess">
          <h4>محاكاة بزمن</h4>
          <p className="muted small">حتى ٤٠ سؤالاً من كل الوحدات بزمن محدد. ليست امتحاناً رسمياً.</p>
          <button className="btn btn-primary" onClick={simulation}>
            <Play aria-hidden="true" /> ابدأ
          </button>
        </article>
        <article className="assess">
          <h4>علاجي</h4>
          <p className="muted small">{weakLessons.size ? `من ${num(weakLessons.size)} درساً أخطأت فيها.` : 'يظهر بعد أن تخطئ في سؤال؛ أخطاؤك تُسجل تلقائياً.'}</p>
          <button className="btn btn-primary" disabled={!weakLessons.size} onClick={remedial}>
            <Play aria-hidden="true" /> ابدأ
          </button>
        </article>
      </div>
    </section>
  )
}

const TABS = [
  { id: 'assess', label: 'التقييمات', icon: Target },
  { id: 'exams', label: 'امتحانات الشهادة', icon: Archive },
  { id: 'sheets', label: 'أوراق العمل', icon: ClipboardList },
  { id: 'bank', label: 'بنك الأسئلة', icon: Database },
] as const

export default function Exams() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('assess')
  const [running, setRunning] = useState<QuizOutput | null>(null)
  return (
    <div className="page">
      <header className="page-head">
        <h1>
          <BookOpenCheck aria-hidden="true" /> الامتحانات والتدريب
        </h1>
      </header>
      {running ? (
        <ExamRunner key={running.id} output={running} onClose={() => setRunning(null)} />
      ) : (
        <>
          <nav className="tabs" aria-label="أقسام التدريب">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                <t.icon aria-hidden="true" /> {t.label}
              </button>
            ))}
          </nav>
          {tab === 'assess' && <AssessTab run={setRunning} />}
          {tab === 'exams' && <ExamsTab run={setRunning} />}
          {tab === 'sheets' && <WorksheetsTab run={setRunning} />}
          {tab === 'bank' && <BankTab run={setRunning} />}
        </>
      )}
    </div>
  )
}
