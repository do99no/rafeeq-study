import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** modal: نافذة وسطية، start/end: درج جانبي */
  variant?: 'modal' | 'wide' | 'reader' | 'start' | 'end'
}

/** يعتمد عنصر dialog الأصلي: حصر التركيز وزر Escape دون مكتبة. */
export function Dialog({ title, onClose, children, variant = 'modal' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const id = useId()
  useEffect(() => {
    const el = ref.current!
    if (!el.open) el.showModal()
    return () => el.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant}`}
      aria-labelledby={id}
      onCancel={(e) => {
        if (e.target !== ref.current) return // إلغاء منتقي الملفات يصل إلى هنا أيضاً
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => (pressedBackdrop.current = e.target === ref.current)}
      onClick={(e) => e.target === ref.current && pressedBackdrop.current && onClose()}
    >
      <div className="dialog-box">
        <header className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <X />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  )
}

export function ConfirmDialog(p: { title: string; text: string; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      <p className="muted">{p.text}</p>
      <div className="dialog-actions">
        <button
          className="btn btn-danger"
          onClick={() => {
            p.onConfirm()
            p.onClose()
          }}
        >
          {p.action}
        </button>
        <button className="btn" onClick={p.onClose}>
          تراجع
        </button>
      </div>
    </Dialog>
  )
}
