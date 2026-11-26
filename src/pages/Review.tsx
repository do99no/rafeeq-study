import { lazy, Suspense, useState } from 'react'
import { GraduationCap, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { ago, num } from '../lib/format'
import { outputDetail, outputMeta } from '../lib/outputs'
import { Link } from '../router'
import { actions, useData } from '../store/store'
import type { OutputKind, StudyOutput } from '../types'

const OutputDialog = lazy(() => import('../components/outputs/OutputDialog'))

const TABS: { kind: OutputKind; label: string; empty: string }[] = [
  { kind: 'cards', label: 'البطاقات', empty: 'أنشئ بطاقات من أدوات الدراسة داخل أي دفتر.' },
  { kind: 'summary', label: 'الملخصات', empty: 'أنشئ ملخصاً من أدوات الدراسة داخل أي دفتر.' },
  { kind: 'quiz', label: 'الاختبارات', empty: 'أنشئ اختباراً من أدوات الدراسة داخل أي دفتر.' },
  { kind: 'note', label: 'الملاحظات', empty: 'اكتب ملاحظة، أو احفظ إجابة، من داخل أي دفتر.' },
  { kind: 'compare', label: 'المقارنات', empty: 'أنشئ مقارنة من أدوات الدراسة داخل أي دفتر.' },
  { kind: 'mindmap', label: 'الخرائط', empty: 'أنشئ خريطة ذهنية من أدوات الدراسة داخل أي دفتر.' },
]
const ACTION: Record<OutputKind, string> = { cards: 'ابدأ المراجعة', summary: 'اقرأ الملخص', quiz: 'ابدأ الاختبار', mindmap: 'افتح الخريطة', note: 'افتح الملاحظة', compare: 'اقرأ المقارنة' }

export default function Review() {
  const { outputs, attempts, notebooks } = useData()
  const [kind, setKind] = useState<OutputKind>('cards')
  const [openId, setOpenId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<StudyOutput | null>(null)

  const tab = TABS.find((t) => t.kind === kind)!
  const shown = outputs.filter((o) => o.data.kind === kind)
  const open = outputs.find((o) => o.id === openId)

  return (
    <div className="page">
      <header className="page-head">
        <h1>المراجعة</h1>
      </header>
      <div className="chips tabs">
        {TABS.map((t) => (
          <button key={t.kind} className="chip" aria-pressed={kind === t.kind} onClick={() => setKind(t.kind)}>
            {t.label} <span className="count">{num(outputs.filter((o) => o.data.kind === t.kind).length)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={GraduationCap} title="لا شيء هنا بعد" text={tab.empty}>
          <Link to="/notebooks" className="btn btn-primary">
            افتح الدفاتر
          </Link>
        </EmptyState>
      ) : (
        <ul className="review-grid">
          {shown.map((o) => {
            const Icon = outputMeta[o.data.kind].icon
            const tries = attempts.filter((a) => a.outputId === o.id)
            return (
              <li key={o.id} className="review-card">
                <div className="review-top">
                  <span className="book-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <button className="icon-btn" onClick={() => setRemoving(o)} aria-label={`حذف «${o.title}»`}>
                    <Trash2 />
                  </button>
                </div>
                <h3>{o.title}</h3>
                <p className="muted">
                  {notebooks.find((n) => n.id === o.notebookId)?.subject}، {outputDetail(o)}، {ago(o.createdAt)}
                </p>
                {o.data.kind === 'cards' && (
                  <div className="known">
                    <progress max={o.data.cards.length} value={o.data.known.length} aria-label="البطاقات المحفوظة" />
                    <small className="muted">
                      تعرف {num(o.data.known.length)} من {num(o.data.cards.length)}
                    </small>
                  </div>
                )}
                {o.data.kind === 'quiz' && (
                  <ul className="tries">
                    {tries.length === 0 && <li className="muted">لم تحل هذا الاختبار بعد.</li>}
                    {tries.slice(0, 3).map((a) => (
                      <li key={a.id}>
                        <strong>
                          {num(a.score)} من {num(a.total)}
                        </strong>
                        <small className="muted">{ago(a.at)}</small>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn btn-block" onClick={() => setOpenId(o.id)}>
                  {o.data.kind === 'quiz' && tries.length ? 'أعد الاختبار' : ACTION[kind]}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <Suspense fallback={null}>
          <OutputDialog key={open.id} output={open} onClose={() => setOpenId(null)} />
        </Suspense>
      )}
      {removing && (
        <ConfirmDialog title="حذف من المراجعة" text={`سيُحذف «${removing.title}» نهائياً.`} action="حذف" onConfirm={() => actions.deleteOutput(removing.id)} onClose={() => setRemoving(null)} />
      )}
    </div>
  )
}
