import { useState } from 'react'
import { Check, ChevronLeft, CircleAlert, Clock, Flag } from 'lucide-react'
import { Dialog } from './Dialog'
import { Ring } from './SubjectVisual'
import { locale, num } from '../lib/format'
import { MAX_STUDY_MIN, SLEEP_H, MEALS_H, SESSION_MIN, BREAK_MIN, type Session } from '../lib/intensive'
import { startStudy } from '../lib/study'
import { go } from '../router'
import { todayActiveMs, useTracker } from '../services/server/tracker'
import { toggleChecked, useIntensive } from '../services/study/intensiveData'

const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
const hours = (m: number) => {
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return h ? `${num(h)} س${r ? ` و${num(r)} د` : ''}` : `${num(r)} د`
}

/** خطة إنهاء المنهج قبل الموعد: مساحة واحدة هادئة؛ مهمة اليوم الحالية بارزة، والتفاصيل عند الطلب */
export function IntensivePlan() {
  const { plan, preparing, todaySessions, checked, doneKeys } = useIntensive()
  useTracker()
  const [all, setAll] = useState(false)
  const [rest, setRest] = useState(false)
  if (!plan) return null
  // لا أرقام جزئية قبل فهرسة المنهج كله
  if (preparing)
    return (
      <section className="panel iplan" aria-busy="true">
        <h2>خطة إنهاء المنهج</h2>
        <p className="muted">يحسب رفيق حجم منهجك من كتبك… تظهر الخطة كاملة بعد قليل.</p>
      </section>
    )
  const isDone = (s: Session) => doneKeys.has(s.key) || checked.includes(s.key)
  const current = todaySessions.find((s) => !isDone(s))
  const doneMin = todaySessions.filter(isDone).reduce((n, s) => n + s.minutes, 0)
  const targetMin = todaySessions.reduce((n, s) => n + s.minutes, 0)
  const studiedMs = todayActiveMs()
  const open = (s: Session) => {
    if (s.kind === 'lesson' && s.bookId) startStudy(s.bookId, { bookId: s.bookId, from: s.from!, to: s.to!, title: s.title.replace(/ \(الجزء .*\)$/, ''), sectionId: s.sectionId })
    else if (s.kind === 'review' || s.kind === 'terms') go('/review')
    else go('/exams')
  }
  const atRisk = plan.phase === 'learn' && (!plan.feasible || plan.behindMin > 30)
  const behindSubjects = plan.subjects.filter((x) => x.behind)
  const doneSubjects = plan.subjects.filter((x) => x.remainingMin === 0).length
  const pct = Math.round(plan.doneFraction * 100)
  return (
    <section className="panel iplan" aria-labelledby="iplan-h">
      <header className="iplan-head">
        <Ring value={plan.totalMin ? pct : null} size={64} stroke={6} label={`أنجزت ${pct}٪ من المنهج`} />
        <div className="grow">
          <h2 id="iplan-h">{plan.phase === 'learn' ? 'خطة إنهاء المنهج' : plan.phase === 'exam' ? 'الاستعداد للامتحانات' : 'الامتحانات'}</h2>
          <p className="muted">
            {plan.phase === 'learn'
              ? `بقي ${num(plan.daysLeft)} يوماً حتى ${longDate(plan.finish)} · ${num(doneSubjects)} من ${num(plan.subjects.length)} مواد مكتملة`
              : `حتى الامتحانات في ${longDate(plan.exam)}`}
          </p>
        </div>
      </header>

      {atRisk && (
        <p className="iplan-alert" role="status">
          <CircleAlert aria-hidden="true" />
          <span>
            {!plan.feasible
              ? `ما تبقى (${hours(plan.remainingMin)}) يحتاج إلى ${hours(plan.requiredPerDay)} يومياً، وأقصى ما يتسع له اليوم ${hours(MAX_STUDY_MIN)} مع ٨ ساعات نوم. بهذه الوتيرة تنتهي في ${longDate(plan.projectedFinish)}. الحلول: تقديم المواد المتأخرة، والاكتفاء بالمراجعة السريعة لما أتقنته، وتمديد الإنهاء إلى ${longDate(plan.projectedFinish)} مع إبقاء فبراير ومارس للمراجعة.`
              : `أنت متأخر نحو ${hours(plan.behindMin)} عن خطتك. وزّع رفيق المتبقي على الأيام القادمة: ${hours(plan.requiredPerDay)} يومياً${plan.extraPerDay ? ` (${hours(plan.extraPerDay)} زيادة)` : ''}${behindSubjects.length ? `، وأكثر المواد تأثراً: ${behindSubjects.map((x) => x.subject).join('، ')}` : ''}.`}
          </span>
        </p>
      )}

      <div className="iplan-today">
        <div className="iplan-meter">
          <span>اليوم: {hours(doneMin)} من {hours(targetMin)} مهام{studiedMs ? ` · درست ${hours(studiedMs / 60000)}` : ''}</span>
          <span className="sp-bar"><span style={{ width: `${targetMin ? Math.min(100, (doneMin / targetMin) * 100) : 0}%` }} /></span>
        </div>
        {todaySessions.length === 0 ? (
          <p className="muted">لا مهام لليوم.</p>
        ) : (
          <ol className="iplan-list">
            {(() => {
              // التركيز: المهمة الحالية واثنتان بعدها، والبقية عند الطلب
              const ci = Math.max(0, todaySessions.findIndex((x) => !isDone(x)))
              return rest ? todaySessions : todaySessions.slice(ci, ci + 3)
            })().map((s) => {
              const done = isDone(s)
              const cur = s === current
              return (
                <li key={s.key} data-done={done} data-current={cur}>
                  <button className="iplan-item" onClick={() => open(s)}>
                    <span className="grow">
                      <strong>{s.title}</strong>
                      <small className="muted">
                        {s.subject !== 'كل المواد' ? `${s.subject} · ` : ''}
                        {num(s.minutes)} دقيقة{s.kind === 'lesson' && s.ready === false ? ' · من صفحات الكتاب مع رفيق' : ''}
                      </small>
                      {cur && <span className="iplan-steps">{s.steps.join(' ← ')}</span>}
                    </span>
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  {s.kind !== 'lesson' ? (
                    <button className="icon-btn" aria-pressed={done} onClick={() => toggleChecked(s.key)} aria-label={done ? 'ألغِ الإنجاز' : 'أنجزته'} title={done ? 'منجز' : 'علّمه منجزاً'}>
                      <Check />
                    </button>
                  ) : done ? (
                    <Check className="iplan-ok" aria-label="مكتمل" />
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
        {todaySessions.length > 3 && (
          <button className="text-link iplan-rest" aria-expanded={rest} onClick={() => setRest(!rest)}>
            {rest ? 'إخفاء بقية المهام' : `بقية مهام اليوم (${num(todaySessions.length - Math.min(3, todaySessions.filter((x) => !isDone(x)).length))})`}
          </button>
        )}
      </div>

      <details className="iplan-more">
        <summary>المواد والجدول الكامل</summary>
        <ul className="iplan-subjects">
          {plan.subjects.map((x) => (
            <li key={x.subject} data-behind={x.behind}>
              <span className="grow">
                <strong>{x.subject}</strong>
                <small className="muted">
                  {x.remainingMin === 0
                    ? 'مكتملة'
                    : `${num(x.remainingLessons)} من ${num(x.lessons)} دروس متبقية · ${hours(x.remainingMin)} · تنتهي ${x.finish ? dayName(x.finish) : '—'}`}
                  {x.notReady ? ` · ${num(x.notReady)} بلا محتوى جاهز بعد` : ''}
                </small>
              </span>
              {x.behind && <span className="iplan-tag"><Flag aria-hidden="true" /> متأخرة</span>}
            </li>
          ))}
        </ul>
        <p className="muted iplan-day">
          <Clock aria-hidden="true" /> يومك: نوم {num(SLEEP_H)} ساعات (ثابتة)، ووجبات ساعة واحدة، ودراسة {hours(plan.perDay)} في جلسات {num(SESSION_MIN)} دقيقة بينها فواصل {num(BREAK_MIN)} دقائق. أقصى ما يتسع له اليوم {hours(MAX_STUDY_MIN)} من {num(24 - SLEEP_H - MEALS_H)} ساعة متاحة.
        </p>
        <button className="btn btn-sm" onClick={() => setAll(true)}>الجدول يوماً بيوم</button>
      </details>

      {all && (
        <Dialog variant="wide" back="رجوع" title={plan.phase === 'learn' ? 'جدول إنهاء المنهج' : 'جدول الاستعداد للامتحانات'} onClose={() => setAll(false)}>
          <ol className="iplan-days">
            {plan.days.slice(0, 120).map((d) => (
              <li key={d.date}>
                <h3>{dayName(d.date)} <small className="muted">{hours(d.minutes)}</small></h3>
                <ul>
                  {d.sessions.map((s) => (
                    <li key={s.key}>
                      {s.title} <small className="muted">· {s.subject !== 'كل المواد' ? `${s.subject} · ` : ''}{num(s.minutes)} د</small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </section>
  )
}
