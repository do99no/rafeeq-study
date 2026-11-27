import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, LoaderCircle, MessageCircleQuestion, RotateCcw, Sparkles, X } from 'lucide-react'
import { normalize, num } from '../../lib/format'
import { queueAsk } from '../../lib/study'
import { go } from '../../router'
import { Unavailable } from '../../services/ai/manager'
import { explainMistake, gradeAnswer, OPEN_TYPES, QUESTION_TYPES } from '../../services/study/generate'
import { actions } from '../../store/store'
import type { QuizQuestion, StudyOutput, Verdict } from '../../types'
import { CiteLink, Inline, RichText } from '../RichText'

interface Reply {
  given: string
  /** null: تنتظر التصحيح */
  verdict: Verdict | null
  feedback?: string
}
const SCORE: Record<Verdict, number> = { correct: 1, partial: 0.5, wrong: 0, skipped: 0 }

export function QuizView({ output, questions, onClose }: { output: StudyOutput; questions: QuizQuestion[]; onClose?: () => void }) {
  const [index, setIndex] = useState(0)
  const [replies, setReplies] = useState<Reply[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const ctrl = useRef<AbortController>(null)
  useEffect(() => () => ctrl.current?.abort(), [])
  const total = questions.length
  const score = replies.reduce((s, r) => s + (r.verdict ? SCORE[r.verdict] : 0), 0)

  const explainHere = (q: QuizQuestion) => {
    queueAsk(output.notebookId, { text: `اشرح لي هذا السؤال وإجابته الصحيحة: ${q.q}`, task: 'answer', basis: [{ bookId: q.cite.bookId, i: q.cite.chunk }] })
    onClose?.()
    go(`/notebooks/${output.notebookId}`)
  }

  if (index >= total) {
    const wrong = questions.filter((_, i) => replies[i]?.verdict !== 'correct')
    const topics = [...new Set(wrong.map((q) => q.cite.section ?? `${q.cite.bookTitle}، ص ${num(q.cite.page)}`))]
    return (
      <div className="quiz-done">
        <p className="quiz-score">
          {num(score)} <small>من {num(total)}</small>
        </p>
        {wrong.length === 0 ? (
          <p>إجاباتك كلها صحيحة. أحسنت.</p>
        ) : (
          <>
            <p>
              <strong>تحتاج إلى مراجعة:</strong> {topics.join('، ')}
            </p>
            <ul className="quiz-wrong">
              {wrong.map((q) => (
                <li key={q.q}>
                  <span>
                    <Inline text={q.q} />
                  </span>
                  <strong>
                    <Inline text={q.answer} />
                  </strong>
                  <span className="btn-row">
                    <CiteLink cite={q.cite} />
                    <button className="btn btn-sm" onClick={() => explainHere(q)}>
                      <MessageCircleQuestion aria-hidden="true" /> اشرحه لي
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            setIndex(0)
            setReplies([])
            setDraft('')
          }}
        >
          <RotateCcw aria-hidden="true" /> أعد الاختبار
        </button>
      </div>
    )
  }

  const q = questions[index]
  const reply = replies[index] as Reply | undefined
  const put = (r: Reply) => setReplies([...replies.slice(0, index), r])
  const open = OPEN_TYPES.includes(q.type)

  const grade = async (given: string) => {
    const c = (ctrl.current = new AbortController())
    setBusy(true)
    setNote('')
    try {
      const r = await gradeAnswer(q, given, c.signal)
      if (!c.signal.aborted) put({ given, verdict: r.verdict, feedback: r.text })
    } catch (e) {
      if (c.signal.aborted) return
      put({ given, verdict: null })
      setNote(e instanceof Unavailable ? 'التصحيح التلقائي غير متاح الآن. قارن إجابتك بالإجابة النموذجية وحدّد النتيجة.' : 'تعذّر التصحيح. قارن إجابتك بالإجابة النموذجية.')
    }
    setBusy(false)
  }
  const explain = async () => {
    if (!reply) return
    const c = (ctrl.current = new AbortController())
    setBusy(true)
    try {
      const text = await explainMistake(q, reply.given, c.signal)
      if (!c.signal.aborted) put({ ...reply, feedback: text })
    } catch {
      if (!c.signal.aborted) setNote('الشرح يحتاج إلى خدمة الذكاء الاصطناعي، وهي غير متاحة الآن. راجع الصفحة من الرابط.')
    }
    setBusy(false)
  }
  const finish = () => {
    const all = [...replies]
    const results = questions.map((_, i) => all[i]?.verdict === 'correct')
    actions.addAttempt({ outputId: output.id, score, total, results })
    actions.addMistakes(
      questions.flatMap((x, i) =>
        results[i] ? [] : [{ bookId: x.cite.bookId, bookTitle: x.cite.bookTitle, page: x.cite.page, topic: x.cite.section ?? output.title.replace(/^[^:]+:\s*/, ''), q: x.q, answer: x.answer, given: all[i]?.given, source: 'quiz' as const, notebookId: output.notebookId }],
      ),
    )
  }

  return (
    <div className="quiz">
      <div className="quiz-meta">
        <p className="muted">
          السؤال {num(index + 1)} من {num(total)}، {QUESTION_TYPES[q.type]}
        </p>
        <small className="ai-tag">
          <Sparkles aria-hidden="true" /> {q.origin ?? 'من إعداد رفيق اعتماداً على كتابك'}
        </small>
      </div>
      <progress max={total} value={index + (reply?.verdict ? 1 : 0)} aria-label="التقدم في الاختبار" />
      <h3>
        <Inline text={q.q} />
      </h3>
      {q.options ? (
        <div className="quiz-options">
          {q.options.map((o) => {
            const state = !reply ? undefined : o === q.answer ? 'right' : o === reply.given ? 'wrong' : undefined
            return (
              <button key={o} className="quiz-option" data-state={state} disabled={!!reply} onClick={() => put({ given: o, verdict: o === q.answer ? 'correct' : 'wrong' })}>
                <span className="grow">
                  <Inline text={o} />
                </span>
                {state === 'right' && <Check aria-label="الإجابة الصحيحة" />}
                {state === 'wrong' && <X aria-label="إجابتك غير صحيحة" />}
              </button>
            )
          })}
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            const given = draft.trim()
            if (!given || busy) return
            if (q.type === 'fill' && normalize(given) === normalize(q.answer)) put({ given, verdict: 'correct' })
            else void grade(given)
          }}
        >
          <textarea className="input" rows={q.type === 'fill' ? 1 : q.type === 'problem' || q.type === 'essay' ? 6 : 3} value={draft} disabled={!!reply || busy} onChange={(e) => setDraft(e.target.value)} placeholder={q.type === 'problem' ? 'اكتب خطوات الحل والناتج بوحدته' : 'اكتب إجابتك'} aria-label="إجابتك" />
          {!reply && (
            <button className="btn btn-primary" disabled={!draft.trim() || busy}>
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />} {open || q.type === 'fill' ? 'صحّح إجابتي' : 'تحقق'}
            </button>
          )}
        </form>
      )}
      <div aria-live="polite">
        {reply && (
          <div className="quiz-why" data-v={reply.verdict ?? 'pending'}>
            {reply.verdict && (
              <p className="verdict" data-v={reply.verdict}>
                {reply.verdict === 'correct' ? 'إجابة صحيحة.' : reply.verdict === 'partial' ? 'إجابة صحيحة جزئياً.' : 'إجابة غير صحيحة.'}
              </p>
            )}
            {reply.feedback && <RichText text={reply.feedback} />}
            {(!q.options || reply.verdict !== 'correct') && (
              <p>
                <strong>الإجابة الصحيحة: </strong>
                <Inline text={q.answer} />
              </p>
            )}
            {q.why && (
              <p>
                <Inline text={q.why} />
              </p>
            )}
            {note && <p className="hint">{note}</p>}
            {q.flag && <p className="warn">تحتاج مراجعة: {q.flag}</p>}
            <blockquote className="cite-quote">
              <p>
                <Inline text={q.cite.quote} />
              </p>
              <CiteLink cite={q.cite} />
            </blockquote>
          </div>
        )}
      </div>
      {reply && reply.verdict === null ? (
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => put({ ...reply, verdict: 'correct' })}>
            <Check aria-hidden="true" /> أجبت بشكل صحيح
          </button>
          <button className="btn" onClick={() => put({ ...reply, verdict: 'wrong' })}>
            <X aria-hidden="true" /> أحتاج إلى مراجعتها
          </button>
        </div>
      ) : (
        reply && (
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                if (index + 1 === total) finish()
                setIndex(index + 1)
                setDraft('')
                setNote('')
              }}
            >
              {index + 1 === total ? 'عرض النتيجة' : 'السؤال التالي'} <ArrowLeft aria-hidden="true" />
            </button>
            {reply.verdict !== 'correct' && !reply.feedback && (
              <button className="btn" disabled={busy} onClick={() => void explain()}>
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <MessageCircleQuestion aria-hidden="true" />} اشرح لي خطئي
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}
