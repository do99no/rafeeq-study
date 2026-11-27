import { useMemo, useState } from 'react'
import { Archive, BookOpenCheck, ClipboardList, Database, LoaderCircle, Play, Shuffle, Target, TriangleAlert } from 'lucide-react'
import { ExamRunner } from '../components/exams/ExamRunner'
import { normalize } from '../lib/arabic'
import { num } from '../lib/format'
import { notebookFor } from '../lib/study'
import { Link } from '../router'
import { useDocs } from '../services/books/process'
import { buildExam, coverage, EXAM_SOURCES, lessonOf, type ExamSource } from '../services/study/exams'
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
        <TriangleAlert aria-hidden="true" /> لم يُعثر في الكتب الخمسة عشر المتوفرة على أي امتحان شهادة سوداني سابق مؤرخ، ولا على نموذج إجابة رسمي. المتوفر نماذج وأسئلة بنمط الشهادة، وكل منها موسوم بمصدره. لإضافة امتحانات السنوات السابقة يلزم توفير ملفاتها من مصدر رسمي.
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
  return (
    <>
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
function BankTab({ run }: { run: (o: QuizOutput) => void }) {
  const data = useData()
  const [book, setBook] = useState('')
  const [type, setType] = useState('')
  const [origin, setOrigin] = useState('')
  const [count, setCount] = useState(10)
  const [minutes, setMinutes] = useState(20)
  const bank = useMemo(() => {
    const seen = new Set<string>()
    const out: QuizQuestion[] = []
    for (const o of data.outputs)
      if (isQuiz(o))
        for (const q of o.data.questions) {
          const k = normalize(q.q)
          if (q.pageTask || seen.has(k)) continue
          seen.add(k)
          out.push(q)
        }
    return out
  }, [data.outputs])
  const list = bank.filter((q) => (!book || q.cite.bookId === book) && (!type || q.type === type) && (!origin || (origin === 'rafeeq' ? !q.origin : !!q.origin)))
  const books = [...new Map(bank.map((q) => [q.cite.bookId, q.cite.bookTitle])).entries()]
  const mixed = () => {
    // دون تكرار داخل الاختبار، وبترتيب عشوائي
    const pick = [...list].map((q) => ({ q, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, count).map((x) => x.q)
    if (!pick.length) return
    run(save(`اختبار مختلط من بنك الأسئلة (${num(pick.length)})`, pick[0].cite.bookId, pick, { mode: 'mixed', minutes, estimated: true, marks: pick.length }))
  }
  return (
    <section className="panel form">
      <p className="muted">
        في بنكك {num(bank.length)} سؤالاً مختلفاً من اختباراتك وأوراق عملك ومصادر الامتحانات. كل سؤال يحتفظ بمصدره: «من إعداد رفيق» أو المذكرة.
      </p>
      <div className="grid-2">
        <label className="field">
          <span>الكتاب</span>
          <select className="input" value={book} onChange={(e) => setBook(e.target.value)}>
            <option value="">الكل</option>
            {books.map(([id, t]) => (
              <option key={id} value={id}>
                {t}
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

const TABS = [
  { id: 'exams', label: 'امتحانات الشهادة', icon: Archive },
  { id: 'sheets', label: 'أوراق العمل', icon: ClipboardList },
  { id: 'bank', label: 'بنك الأسئلة', icon: Database },
] as const

export default function Exams() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('exams')
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
          {tab === 'exams' && <ExamsTab run={setRunning} />}
          {tab === 'sheets' && <WorksheetsTab run={setRunning} />}
          {tab === 'bank' && <BankTab run={setRunning} />}
        </>
      )}
    </div>
  )
}
