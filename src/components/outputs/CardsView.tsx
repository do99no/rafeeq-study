import { useState } from 'react'
import { Flag, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { num } from '../../lib/format'
import { CARD_TYPES } from '../../services/study/generate'
import { actions } from '../../store/store'
import type { CardType, Flashcard } from '../../types'
import { CiteLink, Inline } from '../RichText'

const DAY = 86_400_000
/** فترات التكرار المتباعد حسب الصندوق (بالأيام) */
const GAPS = [0, 1, 3, 7, 14, 30]
export const isDue = (c: Flashcard, now = Date.now()) => (c.due ?? 0) <= now
export const mastered = (c: Flashcard) => (c.box ?? 0) >= 3

/** البطاقات القديمة كان لها «أعرفها» فقط: تُعامل كصندوق 3 */
export const normalCards = (cards: Flashcard[], known: string[]) => cards.map((c) => (c.box === undefined && known.includes(c.id) ? { ...c, box: 3, due: 0 } : c))

function Editor({ card, onSave, onCancel }: { card?: Flashcard; onSave: (c: Pick<Flashcard, 'front' | 'back' | 'extra' | 'example' | 'type'>) => void; onCancel: () => void }) {
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [extra, setExtra] = useState(card?.extra ?? '')
  const [example, setExample] = useState(card?.example ?? '')
  const [type, setType] = useState<CardType>(card?.type ?? 'term')
  return (
    <form
      className="form card-editor"
      onSubmit={(e) => {
        e.preventDefault()
        if (front.trim() && back.trim()) onSave({ front: front.trim(), back: back.trim(), extra: extra.trim() || undefined, example: example.trim() || undefined, type })
      }}
    >
      <fieldset className="field">
        <legend>النوع</legend>
        <div className="chips">
          {(Object.keys(CARD_TYPES) as CardType[]).map((t) => (
            <button type="button" key={t} className="chip" aria-pressed={type === t} onClick={() => setType(t)}>
              {CARD_TYPES[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>الوجه الأول (المصطلح أو السؤال)</span>
        <input value={front} maxLength={300} onChange={(e) => setFront(e.target.value)} required />
      </label>
      <label className="field">
        <span>الوجه الآخر (التعريف أو الإجابة)</span>
        <textarea className="input" rows={3} value={back} maxLength={1000} onChange={(e) => setBack(e.target.value)} required />
      </label>
      <label className="field">
        <span>شرح إضافي (اختياري)</span>
        <textarea className="input" rows={2} value={extra} maxLength={800} onChange={(e) => setExtra(e.target.value)} />
      </label>
      <label className="field">
        <span>مثال (اختياري)</span>
        <input value={example} maxLength={400} onChange={(e) => setExample(e.target.value)} />
      </label>
      <div className="btn-row">
        <button className="btn btn-primary">حفظ</button>
        <button type="button" className="btn" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

export function CardsView({ outputId, cards: raw, known }: { outputId: string; cards: Flashcard[]; known: string[] }) {
  const cards = normalCards(raw, known)
  const [mode, setMode] = useState<'review' | 'list'>('review')
  // ترتيب الجلسة ثابت: المستحق أولاً والصعب في مقدمته
  const [queue, setQueue] = useState(() => {
    const due = cards.filter((c) => isDue(c)).sort((a, b) => Number(!!b.hard) - Number(!!a.hard) || (a.box ?? 0) - (b.box ?? 0))
    return due.map((c) => c.id)
  })
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  const save = (list: Flashcard[]) => actions.setCards(outputId, list)
  const rate = (id: string, r: 'hard' | 'ok' | 'easy') => {
    const now = Date.now()
    save(
      cards.map((c) => {
        if (c.id !== id) return c
        const box = r === 'hard' ? 0 : r === 'ok' ? Math.max(1, c.box ?? 0) : Math.min(5, (c.box ?? 0) + 1)
        return { ...c, box, hard: r === 'hard' ? true : r === 'easy' ? false : c.hard, due: now + (r === 'hard' ? 0 : GAPS[box] * DAY) }
      }),
    )
    // الصعبة تعود في آخر الجولة نفسها
    if (r === 'hard') setQueue([...queue, id])
    setIndex(index + 1)
    setFlipped(false)
  }
  const restart = (ids: string[]) => {
    setQueue(ids)
    setIndex(0)
    setFlipped(false)
    setMode('review')
  }

  const due = cards.filter((c) => isDue(c)).length
  const stats = (
    <p className="muted">
      أتقنت {num(cards.filter(mastered).length)} من {num(cards.length)}، مستحقة الآن {num(due)}، صعبة {num(cards.filter((c) => c.hard).length)}
    </p>
  )
  const tabs = (
    <div className="segmented" role="group" aria-label="العرض">
      <button aria-pressed={mode === 'review'} onClick={() => setMode('review')}>
        مراجعة
      </button>
      <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
        كل البطاقات
      </button>
    </div>
  )

  if (mode === 'list')
    return (
      <div className="cards">
        <div className="cards-head">
          {tabs}
          <button className="btn btn-sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" /> بطاقة يدوية
          </button>
        </div>
        {stats}
        {editing === 'new' && (
          <Editor
            onCancel={() => setEditing(null)}
            onSave={(c) => {
              save([...cards, { ...c, id: `m${Date.now().toString(36)}`, manual: true, box: 0, due: 0 }])
              setEditing(null)
            }}
          />
        )}
        <ul className="card-list">
          {cards.map((c) =>
            editing === c.id ? (
              <li key={c.id}>
                <Editor
                  card={c}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => {
                    save(cards.map((x) => (x.id === c.id ? { ...x, ...v } : x)))
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={c.id} className="card-item">
                <div className="grow">
                  <small className="card-type">
                    {CARD_TYPES[c.type ?? 'fact']}
                    {c.manual ? '، يدوية' : ''}
                    {mastered(c) ? '، متقنة' : ''}
                  </small>
                  <strong>
                    <Inline text={c.front} />
                  </strong>
                  <span>
                    <Inline text={c.back} />
                  </span>
                </div>
                <button className="icon-btn" aria-pressed={!!c.hard} onClick={() => save(cards.map((x) => (x.id === c.id ? { ...x, hard: !x.hard } : x)))} aria-label={c.hard ? 'إزالة علامة صعبة' : 'وضع علامة صعبة'} title="صعبة">
                  <Flag />
                </button>
                <button className="icon-btn" onClick={() => setEditing(c.id)} aria-label="تعديل البطاقة" title="تعديل">
                  <Pencil />
                </button>
                <button className="icon-btn" onClick={() => save(cards.filter((x) => x.id !== c.id))} aria-label="حذف البطاقة" title="حذف">
                  <Trash2 />
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    )

  const card = cards.find((c) => c.id === queue[index])
  if (!card) {
    const hard = cards.filter((c) => c.hard)
    return (
      <div className="quiz-done">
        <div className="cards-head">{tabs}</div>
        <h3>{queue.length ? 'انتهت الجولة' : 'لا توجد بطاقات مستحقة الآن'}</h3>
        {stats}
        <div className="btn-row">
          {hard.length > 0 && (
            <button className="btn btn-primary" onClick={() => restart(hard.map((c) => c.id))}>
              <Flag aria-hidden="true" /> راجع الصعبة ({num(hard.length)})
            </button>
          )}
          <button className="btn" onClick={() => restart(cards.map((c) => c.id))}>
            <RotateCcw aria-hidden="true" /> راجع كل البطاقات
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="cards">
      <div className="cards-head">
        {tabs}
        <p className="muted">
          {num(index + 1)} من {num(queue.length)}
        </p>
      </div>
      <button key={card.id + index} className="flashcard" data-flipped={flipped} onClick={() => setFlipped(!flipped)} aria-live="polite">
        <small className="card-type">
          {CARD_TYPES[card.type ?? 'fact']}
          {card.hard ? '، صعبة' : ''}
        </small>
        <span className="flash-text">
          <Inline text={flipped ? card.back : card.front} />
          {flipped && card.flag && <small className="flash-more warn">تحتاج مراجعة: {card.flag}</small>}
          {flipped && card.extra && (
            <small className="flash-more">
              <Inline text={card.extra} />
            </small>
          )}
          {flipped && card.example && (
            <small className="flash-more">
              مثال: <Inline text={card.example} />
            </small>
          )}
        </span>
        <small>{flipped ? 'اضغط لعرض الوجه الأول' : 'حاول التذكر ثم اضغط لعرض الإجابة'}</small>
      </button>
      {flipped && card.cite && <CiteLink cite={card.cite} />}
      {flipped ? (
        <div className="btn-row cards-actions">
          <button className="btn" onClick={() => rate(card.id, 'hard')}>
            صعبة
          </button>
          <button className="btn" onClick={() => rate(card.id, 'ok')}>
            تقريباً
          </button>
          <button className="btn btn-primary" onClick={() => rate(card.id, 'easy')}>
            سهلة
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setFlipped(true)}>
          أظهر الإجابة
        </button>
      )}
      {stats}
    </div>
  )
}
