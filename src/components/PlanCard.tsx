import { CalendarDays, CheckCircle2, Circle } from 'lucide-react'
import { dur } from './admin/Charts'
import { num } from '../lib/format'
import { usePlan } from '../services/server/session'
import { todayActiveMs, useTracker } from '../services/server/tracker'
import { useStore } from '../store/store'

/** أهداف الطالب كما وضعها المسؤول، وما أنجزه منها */
export function PlanCard() {
  const p = usePlan()
  useTracker()
  const studied = useStore((s) => s.data.studied)
  const plan = p?.plan
  if (!plan) return null
  const today = todayActiveMs()
  const target = plan.dailyMin * 60_000
  const done = (key: string) => {
    const s = studied[key]
    return !!s && (!!(s.taught && s.taught.k >= s.taught.n) || (!!s.explained && !!s.checks && s.checks.total >= 2 && s.checks.right / s.checks.total >= 0.6))
  }
  const days = plan.examDate ? Math.ceil((Date.parse(plan.examDate) - Date.now()) / 86400_000) : null
  const upcoming = plan.reviewDates.filter((r) => r.date >= new Date().toISOString().slice(0, 10)).slice(0, 3)
  return (
    <section className="panel plan-card" aria-labelledby="plan-h">
      <h2 id="plan-h">
        <CalendarDays aria-hidden="true" /> خطتي
      </h2>
      {plan.dailyMin > 0 && (
        <div className="plan-goal">
          <span>
            دراسة اليوم: {dur(today)} من {dur(target)}
          </span>
          <progress max={target} value={Math.min(today, target)} />
        </div>
      )}
      {days !== null && days >= 0 && <p>باقٍ على الامتحان {num(days)} يوماً.</p>}
      {plan.note && <p className="muted">{plan.note}</p>}
      {!!plan.lessons.length && (
        <ul className="plan-lessons">
          {plan.lessons.map((l) => (
            <li key={l.key} data-done={done(l.key)}>
              {done(l.key) ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />} {l.title}
              {l.book && <small className="muted"> · {l.book}</small>}
              {l.due && <small className="muted"> · قبل {l.due}</small>}
            </li>
          ))}
        </ul>
      )}
      {!!upcoming.length && (
        <p className="muted">
          مواعيد المراجعة: {upcoming.map((r) => `${r.date}${r.note ? ` (${r.note})` : ''}`).join('، ')}
        </p>
      )}
    </section>
  )
}
