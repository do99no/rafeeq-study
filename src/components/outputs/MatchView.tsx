import { useMemo, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { num } from '../../lib/format'
import type { Flashcard } from '../../types'
import { Inline } from '../RichText'

const shuffle = <T,>(a: T[]) => a.map((v) => ({ v, r: Math.random() })).sort((x, y) => x.r - y.r).map((x) => x.v)

/** مطابقة: يختار الطالب مصطلحاً ثم تعريفه. من بطاقات الدرس الجاهزة، دون ذكاء اصطناعي. */
export function MatchView({ cards }: { cards: Flashcard[] }) {
  const [round, setRound] = useState(0)
  const set = useMemo(() => shuffle(cards).slice(0, 6), [cards, round])
  const backs = useMemo(() => shuffle(set), [set])
  const [pick, setPick] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [wrong, setWrong] = useState<string | null>(null)
  const [tries, setTries] = useState(0)
  const choose = (id: string) => {
    if (!pick) return
    setTries((t) => t + 1)
    if (id === pick) {
      setDone((d) => [...d, id])
      setPick(null)
      setWrong(null)
    } else setWrong(id)
  }
  const finished = done.length === set.length
  return (
    <div className="match">
      <p className="muted">اختر من العمود الأول، ثم ما يقابله من العمود الثاني.</p>
      <div className="match-cols">
        <ul>
          {set.map((c) => (
            <li key={c.id}>
              <button className="match-item" aria-pressed={pick === c.id} data-done={done.includes(c.id)} disabled={done.includes(c.id)} onClick={() => (setPick(c.id), setWrong(null))}>
                <Inline text={c.front} />
              </button>
            </li>
          ))}
        </ul>
        <ul>
          {backs.map((c) => (
            <li key={c.id}>
              <button className="match-item" data-done={done.includes(c.id)} data-wrong={wrong === c.id} disabled={done.includes(c.id) || !pick} onClick={() => choose(c.id)}>
                <Inline text={c.back} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {finished && (
        <p className="verdict" data-v="correct">
          <Check aria-hidden="true" /> أكملت المطابقة: {num(set.length)} من {num(set.length)} في {num(tries)} محاولة.
        </p>
      )}
      <button className="btn btn-sm" onClick={() => (setRound((r) => r + 1), setDone([]), setPick(null), setWrong(null), setTries(0))}>
        <RotateCcw aria-hidden="true" /> {finished ? 'جولة جديدة' : 'ابدأ من جديد'}
      </button>
    </div>
  )
}
