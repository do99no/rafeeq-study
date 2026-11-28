import { useState } from 'react'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import { ago, num } from '../lib/format'
import type { SubjectProgress } from '../lib/progress'

/**
 * لوحة تقدم المواد: لكل مادة نسبة التغطية (شريط)، ومؤشر إتقان مستقل، وعدد الدروس المكتملة والمبدوءة والمتبقية،
 * وآخر دراسة، والخطوة التالية. التفاصيل (دروس المادة وحالة كل درس) تُفتح عند الطلب.
 */
export function SubjectProgressList({ items, onNext, compact }: { items: SubjectProgress[]; onNext?: (p: SubjectProgress) => void; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!items.length) return <p className="muted">لا مواد بدروس مفهرسة بعد.</p>
  return (
    <ul className="sp-list">
      {items.map((p) => {
        const none = !p.done && !p.started
        return (
          <li key={p.subject} className="sp-row" data-state={none ? 'none' : 'some'}>
            <div className="sp-head">
              <strong className="sp-name">{p.subject}</strong>
              <span className="sp-pct" aria-label={`التغطية ${p.coverage}٪`}>{none ? 'لم يبدأ بعد' : `${num(p.coverage)}٪`}</span>
            </div>
            <div className="sp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.coverage} aria-label={`تقدم ${p.subject}`}>
              <span style={{ width: `${p.coverage}%` }} />
            </div>
            <div className="sp-meta">
              <span className="sp-mastery" data-level={p.mastery === null ? 'na' : p.mastery >= 80 ? 'high' : p.mastery >= 60 ? 'mid' : 'low'}>
                الإتقان: {p.mastery === null ? p.masteryLabel : `${num(p.mastery)}٪ · ${p.masteryLabel}`}
              </span>
              <span className="muted">
                {num(p.done)} مكتمل · {num(p.started)} بدأته · {num(p.notStarted)} لم يبدأ من {num(p.total)}
                {p.lastAt ? ` · آخر دراسة ${ago(p.lastAt)}` : ''}
              </span>
            </div>
            {!compact && (
              <div className="sp-actions">
                {p.next && onNext && (
                  <button className="text-link sp-next" onClick={() => onNext(p)}>
                    {p.next.why === 'بدأته ولم تكمله' ? 'أكمل' : p.next.why.includes('أخطاء') ? 'راجع' : 'ابدأ'}: {p.next.title} <ChevronLeft aria-hidden="true" />
                  </button>
                )}
                {p.next && !onNext && <span className="muted">الخطوة التالية: {p.next.title} ({p.next.why})</span>}
                <button className="text-link" aria-expanded={open === p.subject} onClick={() => setOpen(open === p.subject ? null : p.subject)}>
                  التفاصيل <ChevronDown aria-hidden="true" />
                </button>
              </div>
            )}
            {open === p.subject && (
              <ol className="sp-lessons">
                {p.lessons.map((l) => (
                  <li key={`${l.bookId}:${l.sectionId}`} data-state={l.state}>
                    <span className="sp-dot" aria-hidden="true" />
                    <span className="grow">{l.title}</span>
                    <small className="muted">
                      {l.state === 'done' ? 'مكتمل' : l.state === 'started' ? 'بدأته' : 'لم يبدأ'}
                      {l.mastery !== null ? ` · ${num(l.mastery)}٪ من ${num(l.answered)}` : ''}
                      {l.openMistakes ? ` · ${num(l.openMistakes)} للمراجعة` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}
