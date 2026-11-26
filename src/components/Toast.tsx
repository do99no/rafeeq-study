import { useEffect, useRef } from 'react'
import { useToast } from '../store/toast'

/** popover يضع التنبيه فوق أي نافذة مفتوحة. */
export function Toast() {
  const text = useToast()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.showPopover) return
    if (el.matches(':popover-open')) el.hidePopover()
    if (text) el.showPopover()
  }, [text])
  return (
    <div ref={ref} popover="manual" className="toast" role="status">
      {text}
    </div>
  )
}
