import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageCircleQuestion, Search, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { num } from '../lib/format'
import { getPdf } from '../services/books/db'
import { useDocs } from '../services/books/process'
import { scopeChunks, textSearch } from '../services/rag/search'
import { PASSAGE_ACTIONS, type PassageAction } from '../services/study/prompts'
import { queueAsk, startStudy } from '../lib/study'
import type { Task } from '../types'
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
  const [fetching, setFetching] = useState(false)
  const [page, setPage] = useState(target.page)
  const [field, setField] = useState(String(target.page))
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [paras, setParas] = useState<Hit[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let close: (() => void) | undefined
    let dead = false
    void (async () => {
      try {
        let blob = await getPdf(bookId, getState().activeId)
        // الكتاب منزّل بفهرسه فقط: يُجلب ملفه الأصلي من المكتبة مرة واحدة
        if (!blob) {
          setFetching(true)
          const { ensurePdf } = await import('../services/books/library')
          if (await ensurePdf(bookId)) blob = await getPdf(bookId, getState().activeId)
          if (!dead) setFetching(false)
        }
        if (dead) return
        if (!blob) return setError('تعذّر جلب صفحات هذا الكتاب. تحقق من الاتصال ثم أعد فتحه، أو نزّله من المكتبة.')
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

  // فقرات الصفحة المقروءة: يختار الطالب واحدة ويطلب شرحها
  useEffect(() => {
    let dead = false
    if (!meta?.chunkCount) return
    void scopeChunks({ bookIds: [bookId], pages: { bookId, from: page, to: page } }).then((h) => !dead && setParas(h.filter((x) => x.text.length > 40)))
    return () => {
      dead = true
    }
  }, [bookId, page, meta?.chunkCount])

  const TASK_OF: Record<PassageAction, Task> = { simple: 'answer', detail: 'answer', steps: 'steps', example: 'examples', terms: 'terms', question: 'check' }
  const askAbout = (h: Hit, a: PassageAction) => {
    const ask = { text: `${PASSAGE_ACTIONS[a].ask} (ص ${num(h.page)})`, task: TASK_OF[a], basis: [{ bookId, i: h.i }], quote: h.text }
    const nb = location.hash.match(/^#\/notebooks\/(.+)$/)?.[1]
    const here = nb && getState().data.notebooks.find((n) => n.id === nb && n.bookIds.includes(bookId))
    openPage(null)
    if (here) queueAsk(here.id, ask)
    else startStudy(bookId, undefined, ask)
  }

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
        {fetching && !error && <p className="thinking">يجلب صفحات الكتاب الأصلية إلى هذا الجهاز (مرة واحدة)…</p>}
        {error ? (
          <p className="reader-error">{error}</p>
        ) : (
          <div className="reader-canvas" ref={box}>
            {!doc && <p className="muted">جارٍ فتح الكتاب…</p>}
            <canvas dir="ltr" ref={canvas} role="img" aria-label={`صفحة ${num(page)}`} />
          </div>
        )}
        {paras.length > 0 && (
          <section className="page-paras" aria-label="اسأل عن فقرة من هذه الصفحة">
            <h3>
              <MessageCircleQuestion aria-hidden="true" /> اسأل رفيق عن فقرة من هذه الصفحة
            </h3>
            {paras.map((h) => (
              <details key={h.i} className="para">
                <summary>{h.text.slice(0, 140)}{h.text.length > 140 ? '…' : ''}</summary>
                <p className="para-text">{h.text}</p>
                <div className="chips">
                  {(Object.keys(PASSAGE_ACTIONS) as PassageAction[]).map((a) => (
                    <button key={a} className="chip" onClick={() => askAbout(h, a)}>
                      {PASSAGE_ACTIONS[a].label}
                    </button>
                  ))}
                </div>
              </details>
            ))}
            <p className="hint">النص مقروء آلياً من الصفحة وقد تخطئ رموزه؛ الصورة أعلاه هي المرجع.</p>
          </section>
        )}
      </div>
    </Dialog>
  )
}
