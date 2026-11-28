import { Atom, BookOpenText, Calculator, Cog, FlaskConical, Languages, Leaf, MoonStar, type LucideIcon } from 'lucide-react'
import { num } from '../lib/format'

/** هوية بصرية خفيفة لكل مادة: أيقونة تناسب طبيعتها (بلا صور ثقيلة) */
export const SUBJECT_ICON: Record<string, LucideIcon> = {
  الرياضيات: Calculator,
  الفيزياء: Atom,
  الكيمياء: FlaskConical,
  الأحياء: Leaf,
  'العلوم الهندسية': Cog,
  'اللغة العربية': BookOpenText,
  'اللغة الإنجليزية': Languages,
  'التربية الإسلامية': MoonStar,
}
export function SubjectIcon({ subject, size = 22 }: { subject: string; size?: number }) {
  const I = SUBJECT_ICON[subject] ?? BookOpenText
  return <I aria-hidden="true" width={size} height={size} />
}

/**
 * حلقة تقدم بنسبة حقيقية فقط (SVG خفيف). value = null: لا بيانات، فتظهر الحلقة فارغة بلا رقم.
 * الحركة تحترم «تقليل الحركة» في الجهاز (من CSS).
 */
export function Ring({ value, size = 48, stroke = 5, label }: { value: number | null; size?: number; stroke?: number; label: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <span className="ring2" role="img" aria-label={label} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring2-track" strokeWidth={stroke} fill="none" />
        {value !== null && v > 0 && <circle cx={size / 2} cy={size / 2} r={r} className="ring2-bar" strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span className="ring2-num">{value === null ? '–' : `${num(v)}٪`}</span>
    </span>
  )
}

/** مؤشر الإتقان: خمس درجات مرئية مع نص، فلا يعتمد على اللون وحده */
export function MasteryDots({ value, label }: { value: number | null; label: string }) {
  const n = value === null ? 0 : Math.ceil(value / 20)
  return (
    <span className="m-dots" data-level={value === null ? 'na' : value >= 80 ? 'high' : value >= 60 ? 'mid' : 'low'} title={label}>
      <span aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i key={i} data-on={i <= n} />)}</span>
      <small>{label}</small>
    </span>
  )
}
