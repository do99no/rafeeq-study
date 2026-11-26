import { useState } from 'react'
import { BookOpen, BookOpenText, Library as LibraryIcon, Pencil, Plus, RotateCcw, ScanText, Search, SearchX, Square, Trash2 } from 'lucide-react'
import { CurriculumPanel } from '../components/CurriculumPanel'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { PdfPicker } from '../components/PdfPicker'
import { statusText } from '../lib/books'
import { fileSize, normalize, num } from '../lib/format'
import { isRunning, processBook, stopProcessing, useDocs } from '../services/books/process'
import type { DocMeta } from '../services/books/types'
import { actions, getState, useData } from '../store/store'
import { openPage } from '../store/viewer'
import type { Book } from '../types'

const LANG: Record<DocMeta['language'], string> = { ar: 'عربي', en: 'إنجليزي', mixed: 'عربي وإنجليزي', unknown: '' }

function details(b: Book, d?: DocMeta) {
  return [
    fileSize(b.sizeBytes),
    d?.pageCount && `${num(d.pageCount)} صفحة`,
    d && LANG[d.language],
    d?.chunkCount && `${num(d.chunkCount)} مقطع`,
    d?.sections.length && `${num(d.sections.length)} عنوان`,
    d?.ocrPages && `${num(d.ocrPages)} صفحة بالتعرف الضوئي`,
    d?.badPages.length && d.pageCount && `${num(d.badPages.length)} صفحة غير مفهرسة`,
  ]
    .filter(Boolean)
    .join('، ')
}

function RenameDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [title, setTitle] = useState(book.title)
  return (
    <Dialog title="اسم الكتاب" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          actions.renameBook(book.id, title.trim())
          onClose()
        }}
      >
        <label className="field">
          <span>الاسم</span>
          <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button className="btn btn-primary">حفظ الاسم</button>
        </div>
      </form>
    </Dialog>
  )
}

export default function Library() {
  const { books, notebooks } = useData()
  const docs = useDocs()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Book | null>(null)
  const [renaming, setRenaming] = useState<Book | null>(null)
  const shown = books.filter((b) => normalize(b.title).includes(normalize(query)))

  return (
    <div className="page">
      <header className="page-head">
        <h1>المكتبة</h1>
        {books.length > 0 && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> إضافة كتاب
          </button>
        )}
      </header>
      <CurriculumPanel key={getState().activeId} />
      {books.length === 0 ? (
        <EmptyState icon={LibraryIcon} title="مكتبتك فارغة" text="أضف كتبك بصيغة PDF مرة واحدة، واستخدمها في أي دفتر.">
          <div className="empty-drop">
            <PdfPicker />
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="filters">
            <label className="search">
              <Search aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن كتاب" aria-label="ابحث عن كتاب" />
            </label>
          </div>
          {shown.length ? (
            <ul className="book-list">
              {shown.map((b) => {
                const d = docs[b.id]
                const run = isRunning(b.id)
                const used = notebooks.filter((n) => n.bookIds.includes(b.id)).map((n) => n.title)
                const profileId = getState().activeId
                return (
                  <li key={b.id} className="book-row">
                    <span className="book-icon" aria-hidden="true">
                      <BookOpen />
                    </span>
                    <div className="grow">
                      <h3 className="book-title">{b.title}</h3>
                      <p className="muted">{details(b, d)}</p>
                      {used.length > 0 && <p className="muted">في: {used.join('، ')}</p>}
                      {d?.reason && <p className="muted book-reason">{d.reason}</p>}
                      {!run && !!d?.badPages.length && d.pageCount > 0 && (
                        <details>
                          <summary>الصفحات غير المفهرسة</summary>
                          <span className="chips">
                            {d.badPages.map((n) => (
                              <button key={n} className="chip" onClick={() => openPage({ bookId: b.id, page: n })}>
                                {num(n)}
                              </button>
                            ))}
                          </span>
                        </details>
                      )}
                      {!run && !!d?.weakPages?.length && <p className="muted">{num(d.weakPages.length)} صفحة سقطت منها رسوم أو معادلات أو رموز.</p>}
                      {run && <progress max={1} value={d?.progress ?? 0} aria-label="تقدم المعالجة" />}
                      <div className="btn-row book-actions">
                        {run && (
                          <button className="btn btn-sm" onClick={() => stopProcessing(b.id)}>
                            <Square aria-hidden="true" /> إيقاف
                          </button>
                        )}
                        {!run && (d?.status === 'review' || d?.status === 'done') && d.badPages.length > 0 && (
                          <button className="btn btn-sm" onClick={() => void processBook(b.id, profileId, { ocr: true })}>
                            <ScanText aria-hidden="true" /> أعد معالجة الصفحات غير المفهرسة
                          </button>
                        )}
                        {!run && (!d || d.status === 'failed' || d.status === 'none') && (
                          <button className="btn btn-sm" onClick={() => void processBook(b.id, profileId)}>
                            <RotateCcw aria-hidden="true" /> عالج الكتاب
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="status" data-status={d?.status === 'done' ? 'ready' : d?.status === 'failed' ? 'error' : 'pending'}>
                      {statusText(d)}
                    </span>
                    <span className="row-actions">
                      <button className="icon-btn" onClick={() => openPage({ bookId: b.id, page: 1 })} aria-label={`قراءة «${b.title}»`}>
                        <BookOpenText />
                      </button>
                      <button className="icon-btn" onClick={() => setRenaming(b)} aria-label={`تغيير اسم «${b.title}»`}>
                        <Pencil />
                      </button>
                      <button className="icon-btn" onClick={() => setRemoving(b)} aria-label={`حذف «${b.title}»`}>
                        <Trash2 />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon={SearchX} title="لا كتب بهذا الاسم" text="تأكد من كتابة الاسم، أو أضف الكتاب إلى مكتبتك." />
          )}
          <p className="note">تُحفظ الكتب وفهارسها في هذا المتصفح فقط. التعرف الضوئي قد يستغرق ثواني لكل صفحة، ويمكن إيقافه وإكماله.</p>
        </>
      )}
      {adding && (
        <Dialog title="إضافة كتاب" onClose={() => setAdding(false)}>
          <PdfPicker onAdded={() => setAdding(false)} />
        </Dialog>
      )}
      {renaming && <RenameDialog book={renaming} onClose={() => setRenaming(null)} />}
      {removing && (
        <ConfirmDialog
          title="حذف الكتاب"
          text={`سيُحذف «${removing.title}» من مكتبتك ومن دفاترك. يبقى ملفه إن كان الطالب الآخر يستخدمه.`}
          action="حذف الكتاب"
          onConfirm={() => actions.deleteBook(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
