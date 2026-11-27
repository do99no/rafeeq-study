import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Check, ChevronLeft, ChevronRight, Flag, LoaderCircle, Send, Timer, X } from 'lucide-react'
import { normalize } from '../../lib/arabic'
import { num } from '../../lib/format'
import { focusOf, startStudy } from '../../lib/study'
import { load, remove, save } from '../../services/storage/local'
import { gradePage, lessonOf } from '../../services/study/exams'
import { gradeAnswer, OPEN_TYPES, QUESTION_TYPES } from '../../services/study/generate'
import { logEvent, setTask } from '../../services/server/tracker'
import { actions, getState } from '../../store/store'
import { openPage } from '../../store/viewer'
import type { ExamMeta, QuizQuestion, StudyOutput, Verdict } from '../../types'
import { RichText } from '../RichText'

interface Result {
  verdict: Verdict | 'review'
  text?: string
  topic?: string
}
const VERDICT: Record<string, string> = { correct: 'صحيحة', partial: 'صحيحة جزئياً', wrong: 'خاطئة', review: 'تحتاج مراجعة معلم', skipped: 'لم تُجب' }
const clock = (s: number) => `${num(Math.floor(s / 60))}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * وضع الامتحان: أسئلة، تنقل، علامة للعودة، مؤقت، حفظ تلقائي على الجهاز، ثم تسليم وتصحيح.
 * الاختيار يُصحَّح بمفتاح المصدر؛ المكتوب يُصحَّح تصحيحاً مقترحاً من رفيق، ويُعرض كذلك.
 */
export function ExamRunner({ output, onClose }: { output: StudyOutput & { data: { kind: 'quiz' } }; onClose: () => void }) {
  const qs = output.data.questions
  const meta: ExamMeta = output.data.meta ?? { mode: 'worksheet' }
  const draftKey = `exam-draft:${getState().activeId}:${output.id}`
  const draft = useMemo(() => load<{ answers: string[]; flags: boolean[]; started: number }>(draftKey), [draftKey])
  const [answers, setAnswers] = useState<string[]>(draft?.answers ?? qs.map(() => ''))
  const [flags, setFlags] = useState<boolean[]>(draft?.flags ?? qs.map(() => false))
  const [i, setI] = useState(0)
  const [started] = useState(draft?.started ?? Date.now())
  const [now, setNow] = useState(Date.now())
  const [results, setResults] = useState<Result[] | null>(null)
  const [grading, setGrading] = useState<number | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => {
    setTask('quiz')
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(t)
      ctrl.current?.abort()
    }
  }, [])
  // حفظ تلقائي على هذا الجهاز: لا تضيع الإجابات بإغلاق الصفحة
  useEffect(() => {
    if (!results) save(draftKey, { answers, flags, started })
  }, [answers, flags, started, draftKey, results])

  const elapsed = (now - started) / 1000
  const limit = meta.minutes ? meta.minutes * 60 : 0
  const left = limit ? Math.max(0, limit - elapsed) : 0
  const expired = !!limit && left <= 0
  const q = qs[i]

  const submit = async () => {
    if (results || grading !== null) return
    const missing = answers.filter((a) => !a.trim()).length
    if (missing && !expired && !confirm(`لم تُجب عن ${num(missing)} من ${num(qs.length)}. تسليم الآن؟`)) return
    const c = (ctrl.current = new AbortController())
    const out: Result[] = []
    for (const [k, x] of qs.entries()) {
      const given = answers[k].trim()
      if (!given) {
        out.push({ verdict: 'skipped' })
        continue
      }
      if (!OPEN_TYPES.includes(x.type) && !x.pageTask) {
        out.push({ verdict: normalize(given) === normalize(x.answer) ? 'correct' : 'wrong' })
        continue
      }
      setGrading(k)
      try {
        if (x.pageTask) out.push(await gradePage(x.cite.bookId, x.cite.page, given, meta.subject, c.signal))
        else {
          const g = await gradeAnswer(x, given, c.signal)
          out.push({ verdict: g.verdict, text: g.text })
        }
      } catch {
        if (c.signal.aborted) return
        out.push({ verdict: 'review', text: 'تعذّر التصحيح الآلي الآن (خدمة الذكاء الاصطناعي غير متاحة). قارن إجابتك بالكتاب أو اعرضها على معلم.' })
      }
    }
    setGrading(null)
    setResults(out)
    remove(draftKey)
    // النتيجة تُحفظ في تقدم الطالب، والأخطاء تُربط بدروسها في الكتاب
    // مهام الصفحات بلا نموذج إجابة رسمي: لا تدخل أي درجة رقمية
    const auto = out.map((r, k) => ({ r, x: qs[k] })).filter(({ r, x }) => r.verdict !== 'review' && !x.pageTask)
    if (auto.length) actions.addAttempt({ outputId: output.id, score: auto.reduce((s, { r }) => s + (r.verdict === 'correct' ? 1 : r.verdict === 'partial' ? 0.5 : 0), 0), total: auto.length, results: out.map((r) => r.verdict === 'correct') })
    actions.addMistakes(
      out.flatMap((r, k) => {
        if (r.verdict !== 'wrong' && r.verdict !== 'partial') return []
        const x = qs[k]
        const lesson = lessonOf(x.cite.bookId, x.cite.page)
        return [{ bookId: x.cite.bookId, bookTitle: x.cite.bookTitle, page: lesson?.page ?? x.cite.page, topic: lesson?.title ?? r.topic ?? output.title, q: x.q, answer: x.answer || 'انظر التصحيح المقترح', given: answers[k].slice(0, 300), source: 'quiz' as const }]
      }),
    )
    logEvent('quiz_done', `${output.title}: ${auto.filter(({ r }) => r.verdict === 'correct').length}/${auto.length}`)
  }

  useEffect(() => {
    if (expired && !results && grading === null) void submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])

  const study = (x: QuizQuestion) => {
    const s = lessonOf(x.cite.bookId, x.cite.page)
    logEvent('weak_revisit', s?.title ?? x.q.slice(0, 60))
    startStudy(x.cite.bookId, s ? focusOf(x.cite.bookId, s) : undefined, { text: `اشرح لي من جديد ما يلزم للإجابة عن هذا السؤال: ${x.q}`, task: 'answer' })
  }

  if (results) {
    const auto = results.filter((r, k) => r.verdict !== 'review' && !qs[k].pageTask)
    const score = auto.reduce((s, r) => s + (r.verdict === 'correct' ? 1 : r.verdict === 'partial' ? 0.5 : 0), 0)
    return (
      <div className="exam">
        <header className="exam-head">
          <h2>النتيجة: {output.title}</h2>
          <button className="btn btn-sm" onClick={onClose}>
            إغلاق
          </button>
        </header>
        {auto.length > 0 && <p className="exam-score">
          {num(score)} من {num(auto.length)} {auto.length ? `(${num(Math.round((score / auto.length) * 100))}٪)` : ''}
          {results.some((r) => r.verdict === 'review') && <small className="muted"> · {num(results.filter((r) => r.verdict === 'review').length)} تحتاج تقدير معلم ولم تُحتسب</small>}
        </p>}
        {qs.some((x) => OPEN_TYPES.includes(x.type) || x.pageTask) && <p className="insight">تصحيح الإجابات المكتوبة مقترح من رفيق، وليس نموذج إجابة رسمياً، ولا يُعد درجة نهائية.</p>}
        <ol className="exam-results">
          {qs.map((x, k) => (
            <li key={k} data-v={results[k].verdict}>
              <p className="exam-q">
                <strong>{num(k + 1)}.</strong> <bdi>{x.q}</bdi>
              </p>
              <p>
                <span className={results[k].verdict === 'correct' ? 'pill ok' : results[k].verdict === 'wrong' ? 'pill bad' : 'pill'}>{VERDICT[results[k].verdict]}</span> إجابتك: <bdi>{answers[k] || '—'}</bdi>
              </p>
              {x.answer && (
                <p>
                  الإجابة الصحيحة: <bdi>{x.answer}</bdi> <small className="muted">({x.origin ?? 'من إعداد رفيق اعتماداً على كتابك'})</small>
                </p>
              )}
              {x.why && <p className="muted">{x.why}</p>}
              {results[k].text && <RichText text={results[k].text!} />}
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => openPage({ bookId: x.cite.bookId, page: x.cite.page, quote: x.cite.quote })}>
                  <BookOpenText aria-hidden="true" /> الصفحة ص {num(x.cite.page)}
                </button>
                {results[k].verdict !== 'correct' && (
                  <button className="btn btn-sm btn-primary" onClick={() => study(x)}>
                    اشرح لي الدرس
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="exam" aria-busy={grading !== null}>
      <header className="exam-head">
        <h2>{output.title}</h2>
        <span className={expired ? 'pill bad' : 'pill'} role="timer">
          <Timer aria-hidden="true" /> {limit ? `متبقٍّ ${clock(left)}` : `مضى ${clock(elapsed)}`}
          {limit && meta.estimated ? ' · زمن تقديري' : ''}
        </span>
      </header>
      <p className="muted small">{q.origin ?? 'من إعداد رفيق اعتماداً على كتابك، وليس سؤال امتحان حقيقياً'}</p>
      <nav className="exam-nav" aria-label="الأسئلة">
        {qs.map((_, k) => (
          <button key={k} className={k === i ? 'on' : ''} data-answered={!!answers[k].trim()} data-flag={flags[k]} onClick={() => setI(k)} aria-label={`السؤال ${k + 1}${flags[k] ? '، عليه علامة' : ''}`}>
            {num(k + 1)}
          </button>
        ))}
      </nav>
      <section className="exam-card">
        <p className="exam-q">
          <strong>{num(i + 1)}.</strong> <bdi>{q.q}</bdi> <small className="muted">({QUESTION_TYPES[q.type]})</small>
        </p>
        {q.pageTask && (
          <button className="btn btn-sm" onClick={() => openPage({ bookId: q.cite.bookId, page: q.cite.page })}>
            <BookOpenText aria-hidden="true" /> افتح صفحة الأسئلة ص {num(q.cite.page)}
          </button>
        )}
        {q.options && !OPEN_TYPES.includes(q.type) ? (
          <div className="exam-options" role="radiogroup">
            {q.options.map((o) => (
              <label key={o} className="exam-option" data-on={answers[i] === o}>
                <input type="radio" name={`q${i}`} checked={answers[i] === o} onChange={() => setAnswers(answers.map((a, k) => (k === i ? o : a)))} /> <bdi>{o}</bdi>
              </label>
            ))}
          </div>
        ) : (
          <textarea className="input exam-text" rows={q.pageTask ? 10 : 4} dir="auto" value={answers[i]} placeholder={q.pageTask ? 'اكتب رقم كل سؤال ثم إجابته' : 'إجابتك'} onChange={(e) => setAnswers(answers.map((a, k) => (k === i ? e.target.value : a)))} />
        )}
        <div className="btn-row">
          <button className="btn btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>
            <ChevronRight aria-hidden="true" /> السابق
          </button>
          <button className="btn btn-sm" aria-pressed={flags[i]} onClick={() => setFlags(flags.map((f, k) => (k === i ? !f : f)))}>
            <Flag aria-hidden="true" /> {flags[i] ? 'إزالة العلامة' : 'علامة للعودة'}
          </button>
          <button className="btn btn-sm" disabled={i === qs.length - 1} onClick={() => setI(i + 1)}>
            التالي <ChevronLeft aria-hidden="true" />
          </button>
        </div>
      </section>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={grading !== null} onClick={() => void submit()}>
          {grading !== null ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />} {grading !== null ? `يصحّح ${num(grading + 1)} من ${num(qs.length)}…` : 'تسليم'}
        </button>
        <button className="btn" onClick={onClose}>
          <X aria-hidden="true" /> إغلاق (تُحفظ الإجابات)
        </button>
        <small className="muted">
          <Check aria-hidden="true" /> {num(answers.filter((a) => a.trim()).length)} من {num(qs.length)} مجابة
          {flags.some(Boolean) && ` · ${num(flags.filter(Boolean).length)} عليها علامة`}
        </small>
      </div>
    </div>
  )
}
