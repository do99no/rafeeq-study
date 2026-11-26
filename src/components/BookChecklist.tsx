import type { Book } from '../types'
import { statusText } from '../lib/books'
import { useDocs } from '../services/books/process'

export function BookChecklist({ books, selected, onChange }: { books: Book[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const docs = useDocs()
  return (
    <ul className="checklist">
      {books.map((b) => (
        <li key={b.id}>
          <label className="check-row">
            <input
              type="checkbox"
              checked={selected.includes(b.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, b.id] : selected.filter((x) => x !== b.id))}
            />
            <span className="grow">
              <span className="book-title">{b.title}</span>
              <small className="muted">{statusText(docs[b.id])}</small>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}
