import { num } from '../lib/format'
import { useDocs } from '../services/books/process'
import type { DocMeta } from '../services/books/types'
import type { Scope } from '../services/rag/types'
import type { Book } from '../types'

/** قيمة النطاق: all أو book:معرّف أو sec:معرّف:قسم أو pages:معرّف:من:إلى */
export type ScopeValue = string

export function toScope(v: ScopeValue, activeIds: string[], docs: Record<string, DocMeta>): Scope {
  const [kind, id, a, b] = v.split(':')
  if (kind === 'all' || !activeIds.includes(id)) return { bookIds: activeIds }
  if (kind === 'book') return { bookIds: [id] }
  if (kind === 'sec') {
    const s = docs[id]?.sections.find((x) => x.id === a)
    return s ? { bookIds: [id], pages: { bookId: id, from: s.page, to: s.endPage } } : { bookIds: [id] }
  }
  const from = Math.max(1, Number(a) || 1)
  return { bookIds: [id], pages: { bookId: id, from, to: Math.max(from, Number(b) || from) } }
}

export function ScopePicker({ books, value, onChange, label = 'النطاق' }: { books: Book[]; value: ScopeValue; onChange: (v: ScopeValue) => void; label?: string }) {
  const docs = useDocs()
  const [kind, id, from, to] = value.split(':')
  const valid = kind === 'all' || books.some((b) => b.id === id)
  const selected = !valid ? 'all' : kind === 'pages' ? `pages:${id}` : value
  return (
    <span className="scope">
      <select
        aria-label={label}
        value={selected}
        onChange={(e) => {
          const v = e.target.value
          onChange(v.startsWith('pages:') ? `${v}:1:${Math.min(10, docs[v.slice(6)]?.pageCount || 10)}` : v)
        }}
      >
        <option value="all">كل المصادر المحددة</option>
        {books.map((b) => (
          <optgroup key={b.id} label={b.title}>
            <option value={`book:${b.id}`}>الكتاب كله</option>
            {docs[b.id]?.sections.map((s) => (
              <option key={s.id} value={`sec:${b.id}:${s.id}`}>
                {s.level === 2 ? '  ' : ''}
                {s.title} (ص {num(s.page)})
              </option>
            ))}
            <option value={`pages:${b.id}`}>صفحات محددة…</option>
          </optgroup>
        ))}
      </select>
      {valid && kind === 'pages' && (
        <span className="scope-pages">
          من
          <input type="number" min={1} value={from} onChange={(e) => onChange(`pages:${id}:${e.target.value}:${to}`)} aria-label="من صفحة PDF" />
          إلى
          <input type="number" min={1} value={to} onChange={(e) => onChange(`pages:${id}:${from}:${e.target.value}`)} aria-label="إلى صفحة PDF" />
        </span>
      )}
    </span>
  )
}
