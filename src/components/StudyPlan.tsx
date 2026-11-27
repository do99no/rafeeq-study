import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, TriangleAlert } from 'lucide-react'
import { num } from '../lib/format'
import { buildPlan, type PlanItem } from '../lib/planner'
import { focusOf, startStudy } from '../lib/study'
import { useDocs } from '../services/books/process'
import { usePlan } from '../services/server/session'
import { actions, useData } from '../store/store'
import { Dialog } from './Dialog'

const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' })

/** خطة الدراسة: اليوم أولاً، والخطة كاملة عند الطلب. تُحسب من الدروس المتبقية فعلاً. */
export function StudyPlan() {
  const data = useData()
  const docs = useDocs()
  const admin = usePlan()?.plan
  const examDate = admin?.examDate || data.settings.examDate || ''
  const dailyMin = admin?.dailyMin || data.settings.dailyMin || 90
  const [all, setAll] = useState(false)
  const plan = useMemo(() => {
    if (!examDate) return null
    const books = data.books.filter((b) => docs[b.id]?.sections.length)
    return buildPlan({ books, sections: Object.fromEntries(books.map((b) => [b.id, docs[b.id].sections])), studied: data.studied, mistakes: data.mistakes, examDate, dailyMin })
  }, [examDate, dailyMin, data.books, data.studied, data.mistakes, docs])

  const open = (it: PlanItem) => {
    const s = docs[it.bookId]?.sections.find((x) => x.id === it.sectionId)
    if (s) startStudy(it.bookId, focusOf(it.bookId, s))
    else startStudy(it.bookId)
  }
  const row = (it: PlanItem, i: number) => (
    <li key={i}>
      <button className="recent-row" onClick={() => open(it)}>
        <span className="grow">
          <strong>{it.title}</strong>
          <small className="muted">
            {it.subject}، {num(it.minutes)} دقيقة{it.kind === 'review' ? '، مراجعة خطأ سابق' : ''}
            {it.offExam ? '، خارج امتحان ٢٠٢٥' : ''}
          </small>
        </span>
        <ChevronLeft aria-hidden="true" />
      </button>
    </li>
  )

  if (!examDate)
    return (
      <section className="panel plan-set" aria-labelledby="plan-h">
        <h2 id="plan-h">
          <CalendarDays aria-hidden="true" /> خطة دراستي
        </h2>
        <p className="muted">حدّد موعد امتحانك ووقتك اليومي، فيوزع رفيق الدروس المتبقية على الأيام، ويعيد التوزيع كلما تقدمت أو تأخرت.</p>
        <form
          className="plan-form"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            actions.setSettings({ examDate: String(f.get('date')), dailyMin: Number(f.get('min')) || 90 })
          }}
        >
          <label className="field">
            <span>موعد الامتحان</span>
            <input className="input" type="date" name="date" required min={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="field">
            <span>دقائق الدراسة يومياً</span>
            <input className="input" type="number" name="min" min={30} max={600} defaultValue={90} />
          </label>
          <button className="btn btn-primary">أنشئ خطتي</button>
        </form>
      </section>
    )
  if (!plan) return null
  if (!plan.total)
    return (
      <section className="panel plan-card" aria-labelledby="plan-h">
        <h2 id="plan-h">
          <CalendarDays aria-hidden="true" /> خطة اليوم
        </h2>
        <p className="thinking">يجهّز رفيق كتبك لأول مرة على هذا الجهاز، ثم تظهر خطتك…</p>
      </section>
    )
  const today = plan.days[0]
  const week = plan.days.slice(0, 7)
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0
  return (
    <section className="panel plan-card" aria-labelledby="plan-h">
      <div className="section-head">
        <h2 id="plan-h">
          <CalendarDays aria-hidden="true" /> خطة اليوم
        </h2>
        <button className="text-link" onClick={() => setAll(true)}>
          الخطة كاملة
        </button>
      </div>
      <div className="meter" role="img" aria-label={`أنجزت ${num(plan.done)} من ${num(plan.total)} درساً`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted">
        أنجزت {num(plan.done)} من {num(plan.total)} درساً ({num(pct)}٪). الامتحان {dayName(examDate)}{admin?.examDate ? ' (حدده المسؤول)' : ''}. المطلوب نحو {num(plan.perDay)} دقيقة يومياً.
      </p>
      {plan.perDay > dailyMin && (
        <p className="warn">
          <TriangleAlert aria-hidden="true" /> الدروس المتبقية أكثر من وقتك اليومي ({num(dailyMin)} دقيقة)؛ أعيد توزيعها على {num(plan.perDay)} دقيقة يومياً لتنتهي قبل المراجعة النهائية.
        </p>
      )}
      {today && <ul className="plan-today">{today.items.map(row)}</ul>}
      <p className="small muted">
        هذا الأسبوع: {num(week.reduce((n, d) => n + d.items.filter((i) => i.kind === 'learn').length, 0))} درساً.{plan.finalFrom ? ` المراجعة النهائية تبدأ ${dayName(plan.finalFrom)}.` : ''}
      </p>
      {!data.settings.examDate && !admin?.examDate ? null : !admin?.examDate && (
        <button className="text-link" onClick={() => actions.setSettings({ examDate: undefined })}>
          تغيير موعد الامتحان
        </button>
      )}
      {all && (
        <Dialog title="خطة الدراسة كاملة" variant="wide" onClose={() => setAll(false)}>
          <ol className="plan-days">
            {plan.days.map((d) => (
              <li key={d.date}>
                <h3>
                  {dayName(d.date)} <small className="muted">{num(d.minutes)} دقيقة</small>
                </h3>
                <ul>{d.items.map(row)}</ul>
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </section>
  )
}
