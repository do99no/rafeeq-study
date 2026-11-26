import { useState } from 'react'
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react'
import { normalize, num } from '../../lib/format'
import { actions } from '../../store/store'
import type { QuizQuestion } from '../../types'
import { CiteLink, Inline } from '../RichText'

interface Reply {
  given: string
  /** null: إجابة مفتوحة تنتظر تقدير الطالب */
  right: boolean | null
}

export function QuizView({ outputId, questions }: { outputId: string; questions: QuizQuestion[] }) {
  const [index, setIndex] = useState(0)
  const [replies, setReplies] = useState<Reply[]>([])
  const [draft, setDraft] = useState('')
  const total = questions.length
  const score = replies.filter((r) => r.right).length

  if (index >= total) {
    return (
      <div className="quiz-done">
        <p className="quiz-score">
          {num(score)} <small>من {num(total)}</small>
        </p>
        <p>{score === total ? 'إجاباتك كلها صحيحة.' : 'راجع هذه الأسئلة ثم أعد المحاولة:'}</p>
        <ul className="quiz-wrong">
          {questions.map((q, i) =>
            replies[i]?.right ? null : (
              <li key={i}>
                <span>
                  <Inline text={q.q} />
                </span>
                <strong>
                  <Inline text={q.answer} />
                </strong>
                <CiteLink cite={q.cite} />
              </li>
            ),
          )}
        </ul>
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
  return (
    <div className="quiz">
      <p className="muted">
        السؤال {num(index + 1)} من {num(total)}
      </p>
      <progress max={total} value={index + (reply ? 1 : 0)} aria-label="التقدم في الاختبار" />
      <h3>
        <Inline text={q.q} />
      </h3>
      {q.options ? (
        <div className="quiz-options">
          {q.options.map((o) => {
            const state = !reply ? undefined : o === q.answer ? 'right' : o === reply.given ? 'wrong' : undefined
            return (
              <button key={o} className="quiz-option" data-state={state} disabled={!!reply} onClick={() => put({ given: o, right: o === q.answer })}>
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
            if (!draft.trim()) return
            put({ given: draft, right: q.type === 'fill' && normalize(draft) === normalize(q.answer) ? true : null })
          }}
        >
          <textarea className="input" rows={q.type === 'fill' ? 1 : 4} value={draft} disabled={!!reply} onChange={(e) => setDraft(e.target.value)} placeholder="اكتب إجابتك" aria-label="إجابتك" />
          {!reply && (
            <button className="btn" disabled={!draft.trim()}>
              أظهر الإجابة
            </button>
          )}
        </form>
      )}
      <div aria-live="polite">
        {reply && (
          <div className="quiz-why">
            {reply.right !== null && <strong>{reply.right ? 'إجابة صحيحة. ' : q.options ? 'إجابة غير صحيحة. ' : ''}</strong>}
            {!q.options && (
              <p>
                <strong>الإجابة: </strong>
                <Inline text={q.answer} />
              </p>
            )}
            {q.why && (
              <p>
                <Inline text={q.why} />
              </p>
            )}
            <blockquote className="cite-quote">
              <p>
                <Inline text={q.cite.quote} />
              </p>
              <CiteLink cite={q.cite} />
            </blockquote>
          </div>
        )}
      </div>
      {reply && reply.right === null ? (
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => put({ ...reply, right: true })}>
            <Check aria-hidden="true" /> أجبت بشكل صحيح
          </button>
          <button className="btn" onClick={() => put({ ...reply, right: false })}>
            <X aria-hidden="true" /> أحتاج إلى مراجعتها
          </button>
        </div>
      ) : (
        reply && (
          <button
            className="btn btn-primary"
            onClick={() => {
              if (index + 1 === total) actions.addAttempt({ outputId, score, total })
              setIndex(index + 1)
              setDraft('')
            }}
          >
            {index + 1 === total ? 'عرض النتيجة' : 'السؤال التالي'} <ArrowLeft aria-hidden="true" />
          </button>
        )
      )}
    </div>
  )
}
