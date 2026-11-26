import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { num } from '../lib/format'
import { getPdf } from '../services/books/db'
import { useDocs } from '../services/books/process'
import { textSearch } from '../services/rag/search'
import type { Hit } from '../services/rag/types'
import { getState, useData } from '../store/store'
import { openPage, type ViewerTarget } from '../store/viewer'
import { Dialog } from './Dialog'
import { Inline } from './RichText'

export default function PageViewer({ target }: { target: ViewerTarget }) {
  const { bookId } = target
  const book = useData().books.find((b) => b.id === bookId)
  const meta = useDocs()[bookId]
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(target.page)
  const [field, setField] = useState(String(target.page))
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let close: (() => void) | undefined
    let dead = false
    void (async () => {
      try {
        const blob = await getPdf(bookId, getState().activeId)
        if (!blob) return setError('ملف هذا الكتاب غير موجود في هذا المتصفح. أضفه من المكتبة، وسيُربط تلقائياً باستشهاداته.')
        const pdf = await import('../services/books/pdf')
        const o = await pdf.openDoc(blob)
        if (dead) return o.close()
        close = o.close
        setDoc(o.doc)
      } catch {
        if (!dead) setError('تعذّر فتح هذا الملف.')
      }
    })()
    return () => {
      dead = true
      close?.()
    }
  }, [bookId])

  const total = doc?.numPages ?? 0
  const goTo = (n: number) => {
    const v = Math.min(Math.max(1, Math.round(n) || 1), total || 1)
    setPage(v)
    setField(String(v))
  }

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return
    let task: { cancel: () => void; promise: Promise<void> } | undefined
    let dead = false
    void (async () => {
      const pdf = await import('../services/books/pdf')
      const n = Math.min(Math.max(1, page), doc.numPages)
      const p = await doc.getPage(n)
      if (dead || !canvas.current || !box.current) return
      const css = Math.min(box.current.clientWidth, 900) * zoom
      canvas.current.style.width = `${css}px`
      task = await pdf.renderPage(p, canvas.current, Math.min(css * Math.min(devicePixelRatio, 2), 2600))
      await task.promise
      if (!dead) canvas.current.dataset.page = String(n)
    })().catch((e) => {
      if (!dead && e?.name !== 'RenderingCancelledException') setError('تعذّر عرض هذه الصفحة.')
    })
    box.current.scrollTop = 0
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, page, zoom])

  const bad = meta?.badPages.includes(page)
  const weak = meta?.weakPages?.includes(page)
  return (
    <Dialog variant="reader" title={book?.title ?? 'الكتاب'} onClose={() => openPage(null)}>
      <div className="reader">
        <div className="reader-bar">
          <button className="icon-btn" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="الصفحة السابقة">
            <ChevronRight />
          </button>
          <label className="reader-page">
            صفحة
            <input inputMode="numeric" value={field} onChange={(e) => setField(e.target.value)} onBlur={() => goTo(Number(field))} onKeyDown={(e) => e.key === 'Enter' && goTo(Number(field))} aria-label="رقم صفحة PDF" />
            {total > 0 && <>من {num(total)}</>}
          </label>
          <button className="icon-btn" onClick={() => goTo(page + 1)} disabled={!total || page >= total} aria-label="الصفحة التالية">
            <ChevronLeft />
          </button>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setZoom(Math.max(1, zoom - 0.5))} disabled={zoom <= 1} aria-label="تصغير">
            <ZoomOut />
          </button>
          <button className="icon-btn" onClick={() => setZoom(Math.min(3, zoom + 0.5))} disabled={zoom >= 3} aria-label="تكبير">
            <ZoomIn />
          </button>
        </div>
        {!!meta?.chunkCount && (
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault()
              if (query.trim()) void textSearch(query, { bookIds: [bookId] }, 15).then((r) => setHits(r.hits))
              else setHits(null)
            }}
          >
            <Search aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث داخل الكتاب" aria-label="ابحث داخل الكتاب" />
          </form>
        )}
        {hits && (
          <ul className="reader-hits">
            {hits.length === 0 && <li className="muted">لا نتائج في النص المفهرس.</li>}
            {hits.map((h) => (
              <li key={h.i}>
                <button onClick={() => { goTo(h.page); setHits(null) }}>
                  <b>ص {num(h.page)}</b> {h.text.slice(0, 110)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {target.quote && page === target.page && (
          <blockquote className="cite-quote">
            <p>
              <Inline text={target.quote} />
            </p>
          </blockquote>
        )}
        {bad && <p className="hint">نص هذه الصفحة غير مفهرس، فلن تظهر في البحث.</p>}
        {weak && <p className="hint">بعض رسوم هذه الصفحة أو معادلاتها أو رموزها لم تُقرأ، فاعتمد على صورتها هنا.</p>}
        {error ? (
          <p className="reader-error">{error}</p>
        ) : (
          <div className="reader-canvas" ref={box}>
            {!doc && <p className="muted">جارٍ فتح الكتاب…</p>}
            <canvas dir="ltr" ref={canvas} role="img" aria-label={`صفحة ${num(page)}`} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
