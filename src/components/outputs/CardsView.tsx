import { useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { num } from '../../lib/format'
import { actions } from '../../store/store'
import type { Flashcard } from '../../types'
import { CiteLink, Inline } from '../RichText'

export function CardsView({ outputId, cards, known }: { outputId: string; cards: Flashcard[]; known: string[] }) {
  // ترتيب الجلسة ثابت: تبدأ بالبطاقات غير المحفوظة
  const [queue, setQueue] = useState(() => {
    const rest = cards.filter((c) => !known.includes(c.id))
    return rest.length ? rest : cards
  })
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const restart = (list: Flashcard[]) => {
    setQueue(list)
    setIndex(0)
    setFlipped(false)
  }
  const mark = (id: string, isKnown: boolean) => {
    const rest = known.filter((k) => k !== id)
    actions.setKnown(outputId, isKnown ? [...rest, id] : rest)
    setIndex(index + 1)
    setFlipped(false)
  }

  const summary = (
    <p className="muted">
      تعرف {num(known.length)} من {num(cards.length)}
    </p>
  )
  const card = queue[index]
  if (!card) {
    const rest = cards.filter((c) => !known.includes(c.id))
    return (
      <div className="quiz-done">
        <h3>انتهت الجولة</h3>
        {summary}
        <div className="btn-row">
          {rest.length > 0 && (
            <button className="btn btn-primary" onClick={() => restart(rest)}>
              راجع ما لم تحفظه
            </button>
          )}
          <button className="btn" onClick={() => restart(cards)}>
            <RotateCcw aria-hidden="true" /> كل البطاقات
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="cards">
      <div className="cards-head">
        <p className="muted">
          بطاقة {num(index + 1)} من {num(queue.length)}
        </p>
        {summary}
      </div>
      <button key={card.id} className="flashcard" data-flipped={flipped} onClick={() => setFlipped(!flipped)} aria-live="polite">
        <span className="flash-text">
          <Inline text={flipped ? card.back : card.front} />
        </span>
        <small>{flipped ? 'اضغط لعرض السؤال' : 'اضغط لعرض الإجابة'}</small>
      </button>
      {flipped && <CiteLink cite={card.cite} />}
      <div className="btn-row cards-actions">
        <button className="btn btn-primary" onClick={() => mark(card.id, true)}>
          <Check aria-hidden="true" /> أعرفها
        </button>
        <button className="btn" onClick={() => mark(card.id, false)}>
          <RotateCcw aria-hidden="true" /> أراجعها لاحقاً
        </button>
      </div>
    </div>
  )
}
