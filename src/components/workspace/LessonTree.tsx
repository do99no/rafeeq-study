import { BookOpenText, Check, ChevronDown, Plus, Sparkles } from 'lucide-react'
import { num } from '../../lib/format'
import { focusOf } from '../../lib/study'
import { isSearchable, useDocs } from '../../services/books/process'
import { packOf, usePacks } from '../../services/study/lessonPack'
import { actions, useData } from '../../store/store'
import { openPage } from '../../store/viewer'
import type { Book, Focus, Notebook } from '../../types'

interface Props {
  notebook: Notebook
  books: Book[]
  off: string[]
  onOff: (ids: string[]) => void
  onAdd: () => void
  onPick: (f: Focus) => void
}

/** مصادر الدفتر: كل كتاب بفهرس دروسه، وما جُهّز منها، وما درسه الطالب */
export function LessonTree({ notebook, books, off, onOff, onAdd, onPick }: Props) {
  const docs = useDocs()
  usePacks()
  const { studied } = useData()
  const focus = notebook.focus
  const done = (bookId: string, from: number, to: number) => Object.values(studied).find((s) => s.bookId === bookId && s.from === from && s.to === to)

  return (
    <div className="ws-panel-body tree">
      <p className="hint">يستند رفيق إلى الكتب المحددة فقط. اختر درساً لتبدأ.</p>
      {books.map((b) => {
        const d = docs[b.id]
        const ok = isSearchable(d)
        const sections = d?.sections ?? []
        const ready = sections.filter((s) => packOf(b.id, s.id)).length
        const open = focus?.bookId === b.id || books.length === 1
        return (
          <details key={b.id} className="tree-book" open={open}>
            <summary>
              <input
                type="checkbox"
                disabled={!ok}
                checked={ok && !off.includes(b.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onOff(e.target.checked ? off.filter((x) => x !== b.id) : [...off, b.id])}
                aria-label={`الاستناد إلى «${b.title}»`}
              />
              <span className="grow">
                <span className="book-title">{b.title}</span>
                <small className="muted">
                  {ok ? `${num(sections.length)} درساً ووحدة${ready ? `، ${num(ready)} جاهز` : ''}` : 'قيد التجهيز'}
                </small>
              </span>
              <button className="icon-btn" onClick={(e) => (e.preventDefault(), openPage({ bookId: b.id, page: 1 }))} aria-label={`قراءة «${b.title}»`} title="قراءة الكتاب">
                <BookOpenText />
              </button>
              <ChevronDown className="tree-caret" aria-hidden="true" />
            </summary>
            <ul className="lesson-list">
              {sections.map((s) => {
                const st = done(b.id, s.page, s.endPage)
                const active = focus?.bookId === b.id && focus.sectionId === s.id
                return (
                  <li key={s.id}>
                    <button className="lesson-row" data-level={s.level} aria-current={active ? 'true' : undefined} onClick={() => onPick(focusOf(b.id, s))}>
                      <span className="grow">{s.title}</span>
                      {st && (st.explained || st.taught || st.checks) ? <Check className="studied" aria-label="درسته" /> : packOf(b.id, s.id) ? <Sparkles className="ready" aria-label="محتوى جاهز" /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
      <button className="btn btn-sm btn-block" onClick={onAdd}>
        <Plus aria-hidden="true" /> إضافة مصدر
      </button>
      {notebook.focus && !notebook.focus.sectionId && (
        <button className="text-link" onClick={() => actions.setFocus(notebook.id, undefined)}>
          إلغاء نطاق الصفحات
        </button>
      )}
    </div>
  )
}
