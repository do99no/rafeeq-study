import { useState } from 'react'
import { BookOpenText, BookPlus, Plus, X } from 'lucide-react'
import { statusText } from '../../lib/books'
import { num } from '../../lib/format'
import { isSearchable, useDocs } from '../../services/books/process'
import { actions, useData } from '../../store/store'
import { openPage } from '../../store/viewer'
import type { Book, Notebook } from '../../types'
import { BookChecklist } from '../BookChecklist'
import { Dialog } from '../Dialog'
import { PdfPicker } from '../PdfPicker'

export function AddSourceDialog({ notebook, onClose }: { notebook: Notebook; onClose: () => void }) {
  const { books } = useData()
  const [picked, setPicked] = useState<string[]>([])
  const available = books.filter((b) => !notebook.bookIds.includes(b.id))
  return (
    <Dialog title="إضافة مصدر" onClose={onClose}>
      <div className="form">
        <PdfPicker
          onAdded={(ids) => {
            actions.linkBooks(notebook.id, [...ids, ...picked])
            onClose()
          }}
        />
        {available.length > 0 && (
          <fieldset className="field">
            <legend>من مكتبتك</legend>
            <BookChecklist books={available} selected={picked} onChange={setPicked} />
          </fieldset>
        )}
        {available.length > 0 && (
          <div className="dialog-actions">
            <button
              className="btn btn-primary"
              disabled={!picked.length}
              onClick={() => {
                actions.linkBooks(notebook.id, picked)
                onClose()
              }}
            >
              إضافة إلى الدفتر
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

interface Props {
  notebook: Notebook
  books: Book[]
  off: string[]
  onOff: (ids: string[]) => void
  onAdd: () => void
}

export function SourcesPanel({ notebook, books, off, onOff, onAdd }: Props) {
  const docs = useDocs()
  return (
    <div className="ws-panel-body">
      <button className="btn btn-block" onClick={onAdd}>
        <Plus aria-hidden="true" /> إضافة مصدر
      </button>
      {books.length === 0 ? (
        <div className="mini-empty">
          <BookPlus aria-hidden="true" />
          <p>أضف كتاباً لتسأل رفيق عنه.</p>
        </div>
      ) : (
        <>
          <p className="hint">يبحث رفيق في المصادر المحددة فقط.</p>
          <ul className="checklist">
            {books.map((b) => {
              const d = docs[b.id]
              const ok = isSearchable(d)
              return (
                <li key={b.id} className="source-row">
                  <label className="check-row">
                    <input type="checkbox" disabled={!ok} checked={ok && !off.includes(b.id)} onChange={(e) => onOff(e.target.checked ? off.filter((x) => x !== b.id) : [...off, b.id])} />
                    <span className="grow">
                      <span className="book-title">{b.title}</span>
                      <small className="muted">
                        {statusText(d)}
                        {d?.pageCount ? `، ${num(d.pageCount)} صفحة` : ''}
                      </small>
                    </span>
                  </label>
                  <button className="icon-btn" onClick={() => openPage({ bookId: b.id, page: 1 })} aria-label={`قراءة «${b.title}»`} title="قراءة">
                    <BookOpenText />
                  </button>
                  <button className="icon-btn" onClick={() => actions.unlinkBook(notebook.id, b.id)} aria-label={`إزالة «${b.title}» من الدفتر`} title="إزالة من الدفتر">
                    <X />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
