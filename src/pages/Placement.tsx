import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, CircleAlert, Clock, Flag, FileText, LoaderCircle, Send, Target, X } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import { num } from '../lib/format'
import { focusOf, startStudy } from '../lib/study'
import { go } from '../router'
import { useDocs } from '../services/books/process'
import { load, remove, save } from '../services/storage/local'
import { analyze, offlineKey, refreshPlacement, savePlacement, startPlacement, submitPlacement, usePlacement, type PlacementExam, type PlacementSubject, type SubjectResult } from '../services/study/placement'
import { actions, getState } from '../store/store'
import { openPage } from '../store/viewer'
import { toast } from '../store/toast'

const LEVEL = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' } as const
const mins = (ms: number) => Math.max(0, Math.ceil(ms / 60000))
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${num(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0').replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d])}`
}

/** رحلة تحديد المستوى: اختبار مستقل لكل مادة مقررة، والنتائج والحلول بعد تسليمها كلها */
export default function Placement() {
  const o = usePlacement()
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void refreshPlacement().finally(() => setLoading(false))
  }, [])

  if (open) return <Runner subject={open} onDone={() => { setOpen(null); void refreshPlacement() }} />
  if (loading && !o) return <div className="page"><p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> يحمّل اختبار تحديد المستوى…</p></div>
  if (!o) return <div className="page"><p className="warn">تعذّر الاتصال بالخادم. أعد المحاولة بعد قليل.</p></div>

  const j = o.journey
  const complete = !!j?.completed
  if (!j)
    return (
      <div className="page place">
        <header className="place-head">
          <Target aria-hidden="true" />
          <h1>اختبار تحديد المستوى</h1>
        </header>
        <p className="muted">يُجهَّز اختبار مستقل لكل مادة من موادك، بأسئلة من كتبك فقط روجعت إجاباتها. يبدأ حين تكتمل اختبارات موادك كلها، فلا تظهر نتيجة قبل أن تُختبر في كل المواد.</p>
        {o.pending.length > 0 && <p className="hint">ما زال قيد التجهيز: {o.pending.join('، ')}.</p>}
        <button className="btn" onClick={() => go('/')}>إلى الصفحة الرئيسية</button>
      </div>
    )

  const all = [...j.subjects, ...o.extra]
  const left = j.subjects.filter((s) => s.state !== 'submitted')
  return (
    <div className="page place">
      <header className="place-head">
        <Target aria-hidden="true" />
        <div>
          <h1>{complete ? 'نتائج تحديد المستوى' : 'اختبار تحديد المستوى'}</h1>
          <p className="muted">
            {complete
              ? 'هذه نقطة البداية: خطتك الآن مبنية على ما أتقنته وما تحتاج إلى دراسته.'
              : `اختبار مستقل لكل مادة من موادك (${num(j.subjects.length)}). أجب بهدوء: لن تظهر الإجابات الصحيحة ولا النتيجة حتى تسلّم كل الاختبارات.`}
          </p>
        </div>
      </header>

      {!complete && (
        <>
          <ol className="place-list">
            {j.subjects.map((s) => <SubjectRow key={s.subject} s={s} onOpen={() => setOpen(s.subject)} />)}
          </ol>
          <p className="hint">
            {left.length ? `بقي ${num(left.length)} من ${num(j.subjects.length)}. يُحفظ كل ما تجيبه أولاً بأول، فإن خرجت أو انقطع الاتصال تكمل من حيث توقفت.` : 'سُلّمت كل الاختبارات.'}
          </p>
          {o.pending.length > 0 && <p className="hint">مواد يُجهَّز اختبارها لاحقاً (تُضاف ملحقاً): {o.pending.join('، ')}.</p>}
        </>
      )}
      {complete && o.extra.some((s) => s.state !== 'submitted') && (
        <section className="panel">
          <h2>ملحق</h2>
          <ol className="place-list">{o.extra.filter((s) => s.state !== 'submitted').map((s) => <SubjectRow key={s.subject} s={s} onOpen={() => setOpen(s.subject)} />)}</ol>
        </section>
      )}
      {o.results.length > 0 && <Report results={o.results} order={all.map((s) => s.subject)} />}
    </div>
  )
}

function SubjectRow({ s, onOpen }: { s: PlacementSubject; onOpen: () => void }) {
  const done = s.state === 'submitted'
  return (
    <li className="place-row" data-state={s.state}>
      <span className="place-dot" aria-hidden="true">{done ? <Check /> : null}</span>
      <span className="grow">
        <strong>{s.subject}</strong>
        <small className="muted">
          {num(s.n)} سؤالاً، {num(s.minutes)} دقيقة
          {s.state === 'active' ? `، أجبت ${num(s.answered)}، بقي ${num(mins(s.minutes * 60000 - s.elapsed))} دقيقة` : ''}
          {done ? '، سُلّم' : ''}
        </small>
      </span>
      {!done && (
        <button className="btn btn-sm btn-primary" onClick={onOpen}>
          {s.state === 'active' ? 'تابع' : 'ابدأ'}
        </button>
      )}
    </li>
  )
}

/** الاختبار: سؤال واحد في كل مرة، وحفظ مستمر، ومراجعة قبل التسليم دون أي إشارة إلى الإجابة الصحيحة */
function Runner({ subject, onDone }: { subject: string; onDone: () => void }) {
  const [exam, setExam] = useState<PlacementExam | null>(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number | null>>({})
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [reviewing, setReviewing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [offline, setOffline] = useState(false)
  const base = useRef({ elapsed: 0, at: Date.now() })
  const [, tick] = useState(0)
  const dirty = useRef(false)

  useEffect(() => {
    void startPlacement(subject)
      .then((e) => {
        // ما حُفظ على الجهاز بلا اتصال يُضم إلى المحفوظ في الخادم
        const draft = load<{ answers: Record<string, number | null>; elapsed: number }>(offlineKey(subject))
        const merged = { ...e.answers, ...(draft?.answers ?? {}) }
        base.current = { elapsed: Math.max(e.elapsed, draft?.elapsed ?? 0), at: Date.now() }
        setAnswers(merged)
        if (draft) dirty.current = true
        setExam(e)
        const first = e.items.findIndex((x) => merged[x.id] === undefined || merged[x.id] === null)
        setI(first < 0 ? 0 : first)
      })
      .catch(() => setError('تعذّر فتح الاختبار. تحقق من الاتصال ثم أعد المحاولة.'))
  }, [subject])

  const elapsed = () => base.current.elapsed + (document.visibilityState === 'visible' ? Date.now() - base.current.at : 0)
  const limit = (exam?.minutes ?? 0) * 60000
  // الوقت يُحتسب والصفحة ظاهرة فقط
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'hidden') base.current = { elapsed: base.current.elapsed + Date.now() - base.current.at, at: Date.now() }
      else base.current.at = Date.now()
    }
    document.addEventListener('visibilitychange', vis)
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => (document.removeEventListener('visibilitychange', vis), clearInterval(t))
  }, [])

  const persist = async () => {
    if (!exam || !dirty.current) return
    const snap = { answers, elapsed: elapsed() }
    save(offlineKey(subject), snap)
    try {
      await savePlacement(subject, snap.answers, snap.elapsed)
      dirty.current = false
      remove(offlineKey(subject))
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }
  // حفظ بعد كل إجابة بقليل، وكل ٢٠ ثانية، وعند مغادرة الصفحة
  useEffect(() => {
    const t = setTimeout(() => void persist(), 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers])
  useEffect(() => {
    const t = setInterval(() => void persist(), 20000)
    const leave = () => void persist()
    addEventListener('pagehide', leave)
    addEventListener('online', leave)
    return () => (clearInterval(t), removeEventListener('pagehide', leave), removeEventListener('online', leave))
  })

  const submit = async () => {
    if (!exam) return
    setSending(true)
    save(offlineKey(subject), { answers, elapsed: elapsed() })
    try {
      await submitPlacement(subject, answers, elapsed())
      remove(offlineKey(subject))
      toast(`سُلّم اختبار ${subject}.`)
      onDone()
    } catch {
      setSending(false)
      setConfirm(false)
      toast('تعذّر التسليم الآن. إجاباتك محفوظة على هذا الجهاز؛ أعد المحاولة حين يعود الاتصال.')
    }
  }
  const timeUp = exam && elapsed() >= limit
  useEffect(() => {
    if (timeUp && !sending) {
      toast('انتهى الوقت: يُسلَّم الاختبار بما أجبت.')
      void submit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp])

  if (error) return <div className="page"><p className="warn">{error}</p><button className="btn" onClick={onDone}>رجوع</button></div>
  if (!exam) return <div className="page"><p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> يفتح الاختبار…</p></div>
  if (exam.state === 'submitted') return <div className="page"><p>سُلّم هذا الاختبار ولا يمكن تعديله.</p><button className="btn" onClick={onDone}>رجوع</button></div>

  const items = exam.items
  const x = items[i]
  const answered = items.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null).length
  const set = (v: number | null) => {
    dirty.current = true
    setAnswers((a) => ({ ...a, [x.id]: v }))
  }
  const remaining = limit - elapsed()

  return (
    <div className="page runner place-run">
      <header className="run-bar">
        <button className="icon-btn" onClick={() => void persist().then(onDone)} aria-label="خروج مع حفظ الإجابات" title="خروج (تُحفظ إجاباتك)">
          <X />
        </button>
        <strong className="grow">{subject}</strong>
        <span className="run-time" data-low={remaining < 5 * 60000} aria-label="الوقت المتبقي">
          <Clock aria-hidden="true" /> {clock(remaining)}
        </span>
      </header>
      <div className="run-progress" aria-hidden="true"><span style={{ width: `${(answered / items.length) * 100}%` }} /></div>
      {offline && <p className="hint">لا اتصال: إجاباتك محفوظة على هذا الجهاز وتُرسل حين يعود الاتصال.</p>}

      {reviewing ? (
        <section className="run-review">
          <h2>راجع إجاباتك قبل التسليم</h2>
          <p className="muted">أجبت عن {num(answered)} من {num(items.length)}. اضغط رقم السؤال للعودة إليه. لن تظهر الإجابات الصحيحة إلا بعد تسليم اختبارات كل موادك.</p>
          <ol className="q-grid">
            {items.map((q, k) => (
              <li key={q.id}>
                <button className="q-cell" data-done={answers[q.id] !== undefined && answers[q.id] !== null} data-flag={flags.has(q.id)} onClick={() => (setI(k), setReviewing(false))} aria-label={`السؤال ${k + 1}`}>
                  {num(k + 1)}
                </button>
              </li>
            ))}
          </ol>
          <div className="btn-row">
            <button className="btn" onClick={() => setReviewing(false)}><ArrowRight aria-hidden="true" /> عودة إلى الأسئلة</button>
            <button className="btn btn-primary" onClick={() => setConfirm(true)}><Send aria-hidden="true" /> سلّم الاختبار</button>
          </div>
        </section>
      ) : (
        <section className="run-q" aria-live="polite">
          <p className="muted run-meta">
            السؤال {num(i + 1)} من {num(items.length)}
            {x.unit ? ` · ${x.unit}` : ''} · {LEVEL[x.level]}
          </p>
          <h2 className="run-text">{x.q}</h2>
          <div className="run-options" role="radiogroup" aria-label="الخيارات">
            {x.options.map((op, k) => (
              <button key={k} role="radio" aria-checked={answers[x.id] === k} className="run-option" data-on={answers[x.id] === k} onClick={() => set(answers[x.id] === k ? null : k)}>
                <span className="run-mark" aria-hidden="true">{'أبجدهـ'[k]}</span>
                <span>{op}</span>
              </button>
            ))}
          </div>
          <div className="run-nav">
            <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}><ArrowRight aria-hidden="true" /> السابق</button>
            <button className="btn btn-ghost" aria-pressed={flags.has(x.id)} onClick={() => setFlags((f) => { const n = new Set(f); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n })}>
              <Flag aria-hidden="true" /> {flags.has(x.id) ? 'معلّم للمراجعة' : 'علّمه لأعود إليه'}
            </button>
            {i < items.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setI(i + 1)}>التالي <ArrowLeft aria-hidden="true" /></button>
            ) : (
              <button className="btn btn-primary" onClick={() => setReviewing(true)}>مراجعة وتسليم <ArrowLeft aria-hidden="true" /></button>
            )}
          </div>
          <button className="text-link run-all" onClick={() => setReviewing(true)}>كل الأسئلة ({num(answered)} من {num(items.length)} مجاب)</button>
        </section>
      )}

      {confirm && (
        <Dialog title="تسليم الاختبار" onClose={() => !sending && setConfirm(false)}>
          <p>{answered < items.length ? `بقي ${num(items.length - answered)} سؤالاً بلا إجابة، وتُحتسب خطأً.` : 'أجبت عن كل الأسئلة.'} بعد التسليم لا يمكن تغيير الإجابات.</p>
          <div className="btn-row">
            <button className="btn" disabled={sending} onClick={() => setConfirm(false)}>ليس الآن</button>
            <button className="btn btn-primary" disabled={sending} onClick={() => void submit()}>
              {sending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />} سلّم نهائياً
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

/** التقرير بعد التسليم: لكل مادة الدرجة والتحليل، ولكل سؤال إجابة الطالب والصحيحة وتفسيرها من الكتاب */
function Report({ results, order }: { results: SubjectResult[]; order: string[] }) {
  const sorted = useMemo(() => [...results].sort((a, b) => order.indexOf(a.subject) - order.indexOf(b.subject)), [results, order])
  const [tab, setTab] = useState(sorted[0]?.subject ?? '')
  const docs = useDocs()
  const r = sorted.find((x) => x.subject === tab) ?? sorted[0]
  const a = useMemo(() => (r ? analyze(r) : null), [r])
  const [only, setOnly] = useState<'all' | 'wrong'>('wrong')
  useImportMistakes(results)
  if (!r || !a) return null
  const open = (bookId: string, sectionId: string) => {
    const s = docs[bookId]?.sections.find((x) => x.id === sectionId)
    if (s) startStudy(bookId, focusOf(bookId, s))
    else startStudy(bookId)
  }
  const shown = r.items.filter((x) => only === 'all' || !x.ok)
  return (
    <section className="place-report" aria-label="النتائج">
      <div className="report-sum">
        {sorted.map((s) => (
          <button key={s.subject} className="report-chip" aria-pressed={s.subject === r.subject} onClick={() => setTab(s.subject)}>
            <span>{s.subject}</span>
            <strong>{num(s.percent)}٪</strong>
          </button>
        ))}
      </div>

      <div className="panel report-main">
        <div className="score">
          <div className="ring" style={{ ['--p' as string]: `${r.percent}` }} aria-label={`${r.percent}٪`}>
            <strong>{num(r.percent)}٪</strong>
          </div>
          <dl className="score-facts">
            <div><dt>صحيحة</dt><dd>{num(r.correct)}</dd></div>
            <div><dt>خاطئة</dt><dd>{num(r.wrong)}</dd></div>
            <div><dt>بلا إجابة</dt><dd>{num(r.blank)}</dd></div>
            <div><dt>الوقت</dt><dd>{num(mins(r.elapsed))} من {num(r.minutes)} د</dd></div>
          </dl>
        </div>
        <p className="level"><strong>المستوى المقترح للبدء: {a.level}</strong> — {a.levelNote}</p>
        <div className="sw">
          <div>
            <h3>أتقنت</h3>
            {a.strengths.length ? <ul>{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="muted">لا وحدة أتقنتها كاملة بعد.</p>}
          </div>
          <div>
            <h3>تحتاج إلى دراسة</h3>
            {a.weaknesses.length ? <ul>{a.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="muted">لا ضعف واضح.</p>}
          </div>
        </div>
        {a.start && (
          <button className="btn btn-primary" onClick={() => open(a.start!.bookId, a.start!.sectionId)}>
            <BookOpen aria-hidden="true" /> ابدأ من: {a.start.lesson}
          </button>
        )}
        <details className="units">
          <summary>الوحدات ({num(a.units.length)})</summary>
          <ul>
            {a.units.map((u) => (
              <li key={u.unit} data-state={u.state}>
                <span className="grow">{u.unit}</span>
                <small>{num(u.correct)} من {num(u.total)} · {u.state === 'mastered' ? 'متقن' : u.state === 'partial' ? 'يحتاج مراجعة' : u.basics ? 'ابدأ من الأساسيات' : 'لم يُتقن بعد'}</small>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="report-filter" role="tablist">
        <button role="tab" aria-selected={only === 'wrong'} onClick={() => setOnly('wrong')}>ما أخطأت فيه ({num(r.wrong + r.blank)})</button>
        <button role="tab" aria-selected={only === 'all'} onClick={() => setOnly('all')}>كل الأسئلة ({num(r.total)})</button>
      </div>
      <ol className="answers">
        {shown.map((x) => (
          <li key={x.id} className="answer" data-ok={x.ok}>
            <p className="answer-q">
              {x.ok ? <Check className="ok" aria-label="صحيحة" /> : <CircleAlert className="bad" aria-label={x.given === null ? 'بلا إجابة' : 'خاطئة'} />}
              <span>{x.q}</span>
            </p>
            <dl className="answer-facts">
              <div><dt>إجابتك</dt><dd>{x.given === null ? 'لم تُجب' : x.options[x.given]}</dd></div>
              {!x.ok && <div><dt>الصحيحة</dt><dd>{x.options[x.correct]}</dd></div>}
            </dl>
            <p className="answer-why"><strong>لماذا:</strong> {x.why}</p>
            <blockquote className="answer-src">{x.quote.slice(0, 320)}{x.quote.length > 320 ? '…' : ''}</blockquote>
            <p className="answer-meta">
              <span>{x.book} · {x.lesson} · ص {x.printed ?? num(x.page)}</span>
              <button className="text-link" onClick={() => openPage({ bookId: x.bookId, page: x.page, quote: x.quote })}><FileText aria-hidden="true" /> الصفحة</button>
              {!x.ok && <button className="text-link" onClick={() => open(x.bookId, x.sectionId)}>ادرس الدرس <ChevronLeft aria-hidden="true" /></button>}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** الأخطاء تدخل سجل أخطاء الطالب مرة واحدة: فتظهر في المراجعة والاختبار العلاجي والخطة ومع المدرّس */
function useImportMistakes(results: SubjectResult[]) {
  useEffect(() => {
    const have = new Set(getState().data.mistakes.map((m) => `${m.bookId}|${m.q}`))
    const list = results.flatMap((r) =>
      r.items
        .filter((x) => !x.ok && !have.has(`${x.bookId}|${x.q}`))
        .map((x) => ({ bookId: x.bookId, bookTitle: x.book, page: x.page, topic: x.lesson, q: x.q, answer: x.options[x.correct], ...(x.given !== null ? { given: x.options[x.given] } : {}), source: 'quiz' as const })),
    )
    if (list.length) actions.addMistakes(list)
  }, [results])
}
