import { useState } from 'react'
import { BookOpen, ChevronLeft } from 'lucide-react'
import { num } from '../../lib/format'
import { focusOf } from '../../lib/study'
import { useDocs } from '../../services/books/process'
import type { Book, Focus } from '../../types'
import { Dialog } from '../Dialog'

interface Props {
  books: Book[]
  value?: Focus
  title?: string
  onPick: (f: Focus) => void
  onClose: () => void
}

/** اختيار الدرس: كتاب ثم وحدة أو درس من فهرسه، أو صفحات محددة */
export function LessonPicker({ books, value, title = 'ماذا تدرس الآن؟', onPick, onClose }: Props) {
  const docs = useDocs()
  const [bookId, setBookId] = useState(value?.bookId ?? (books.length === 1 ? books[0].id : ''))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const book = books.find((b) => b.id === bookId)
  const doc = book ? docs[book.id] : undefined
  const sections = doc?.sections ?? []
  const pick = (f: Focus) => {
    onPick(f)
    onClose()
  }

  return (
    <Dialog title={title} onClose={onClose}>
      {!book ? (
        <div className="pick-list">
          {books.length === 0 && <p className="muted">لا توجد كتب جاهزة في هذا الدفتر بعد.</p>}
          {books.map((b) => (
            <button key={b.id} className="pick-row" onClick={() => setBookId(b.id)}>
              <BookOpen aria-hidden="true" />
              <span className="grow">
                <strong>{b.title}</strong>
                <small className="muted">{docs[b.id]?.sections.length ? `${num(docs[b.id].sections.length)} وحدة ودرساً` : 'دون فهرس دروس'}</small>
              </span>
              <ChevronLeft aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="form">
          {books.length > 1 && (
            <button className="text-link back-link" onClick={() => setBookId('')}>
              كل الكتب
            </button>
          )}
          <h3 className="pick-book">{book.title}</h3>
          {sections.length > 0 ? (
            <ul className="lesson-list">
              {sections.map((s) => (
                <li key={s.id}>
                  <button className="lesson-row" data-level={s.level} aria-pressed={value?.bookId === book.id && value.sectionId === s.id} onClick={() => pick(focusOf(book.id, s))}>
                    <span className="grow">{s.title}</span>
                    <small className="muted">
                      ص {num(s.page)}
                      {s.endPage > s.page ? `–${num(s.endPage)}` : ''}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">لا يوجد فهرس دروس لهذا الكتاب. اختر صفحات محددة.</p>
          )}
          <form
            className="pages-pick"
            onSubmit={(e) => {
              e.preventDefault()
              const a = Math.max(1, Math.round(Number(from)) || 1)
              const b = Math.min(doc?.pageCount || a, Math.max(a, Math.round(Number(to)) || a))
              pick({ bookId: book.id, from: a, to: b, title: `${book.title}، ص ${num(a)}${b > a ? `–${num(b)}` : ''}` })
            }}
          >
            <span>أو صفحات PDF من</span>
            <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من صفحة" required />
            <span>إلى</span>
            <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى صفحة" />
            <button className="btn btn-sm">اختيار</button>
          </form>
        </div>
      )}
    </Dialog>
  )
}
