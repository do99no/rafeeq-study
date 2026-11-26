import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span />
        <span />
        <span>
          <Icon />
        </span>
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  )
}
