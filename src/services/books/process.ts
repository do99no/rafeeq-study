import { useSyncExternalStore } from 'react'
import { allDocs, getChunks, getPages, getPdf, putDoc, putPage, putPages, replaceChunks } from './db'
import { analyze, detectLanguage, textQuality } from './structure'
import type { Chunk, DocMeta, PageRec } from './types'

/** حالة الكتب المشتركة بين الشاشات */
let docs: Record<string, DocMeta> = {}
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useDocs = () => useSyncExternalStore(subscribe, () => docs)
export const getDocs = () => docs
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('rafeeq-docs') : undefined

function setLocal(d: DocMeta) {
  docs = { ...docs, [d.id]: d }
  listeners.forEach((l) => l())
}
export async function saveDoc(d: DocMeta) {
  if (gone.has(d.id)) return
  setLocal(d)
  channel?.postMessage(d)
  await putDoc(d)
}
channel?.addEventListener('message', (e) => setLocal(e.data as DocMeta))

export const docsReady = allDocs()
  .then((list) => {
    docs = { ...Object.fromEntries(list.map((d) => [d.id, d])), ...docs }
    listeners.forEach((l) => l())
  })
  .catch(() => {})

export const emptyDoc = (id: string): DocMeta => ({
  id, status: 'none', pageCount: 0, textPages: 0, ocrPages: 0, badPages: [], language: 'unknown', sections: [], chunkCount: 0,
})
export const isSearchable = (d?: DocMeta) => !!d && d.chunkCount > 0

/** كتب حُذفت أثناء معالجتها: لا تُكتب من جديد */
const gone = new Set<string>()
/** كتاب جاهز من حزمة: لا حاجة إلى معالجته على هذا الجهاز */
export async function restoreDoc(meta: DocMeta, pages: PageRec[], chunks: Chunk[]) {
  gone.delete(meta.id)
  await putPages(pages)
  await replaceChunks(meta.id, chunks)
  await saveDoc(meta)
}

const running = new Map<string, AbortController>()
export const isRunning = (id: string) => running.has(id)
export const stopProcessing = (id: string) => running.get(id)?.abort()

/** قفل بين النوافذ: كتاب واحد في كل مرة، ولا يُعالج الكتاب نفسه مرتين. */
const withLock = <T,>(fn: () => Promise<T>) => (navigator.locks ? navigator.locks.request('rafeeq-process', fn) : fn())

/** ينتهي بكل الصفحات المحفوظة ثم يبني الفهرس. */
async function finish(id: string, meta: DocMeta, marks: Parameters<typeof analyze>[2]) {
  await saveDoc({ ...meta, status: 'chunking', progress: undefined })
  const pages = await getPages(id)
  const { sections, chunks } = analyze(id, pages, marks)
  await saveDoc({ ...meta, status: 'indexing', progress: undefined })
  await replaceChunks(id, chunks)
  // نتحقق من المحفوظ فعلاً قبل إعلان الاكتمال
  const saved = (await getChunks(id)).length
  const badPages = pages.filter((p) => !p.ok).map((p) => p.page)
  const weakPages = pages.filter((p) => p.ok && p.weak).map((p) => p.page)
  const textPages = pages.filter((p) => p.ok && p.src === 'text').length
  const ocrPages = pages.filter((p) => p.ok && p.src === 'ocr').length
  const tried = pages.filter((p) => !p.ok && p.src === 'ocr').length
  // صفحات قليلة بلا نص (أغلفة وفواصل) لا تمنع الاكتمال
  const many = saved === 0 || badPages.length > Math.max(2, pages.length * 0.1)
  const status = saved === 0 ? (tried ? 'failed' : 'review') : many ? 'review' : 'done'
  const reason =
    status === 'failed'
      ? 'لم نتمكن من قراءة نص موثوق من صفحات هذا الملف. يمكنك فتح صفحاته الأصلية.'
      : many
        ? tried === badPages.length
          ? 'بقيت صفحات لم يُقرأ نصها بجودة كافية، ولم تدخل البحث.'
          : 'صفحات كثيرة مصورة أو نصها غير مقروء، وتحتاج إلى التعرف الضوئي.'
        : undefined
  await saveDoc({
    ...meta, status, reason, progress: undefined, pageCount: pages.length, textPages, ocrPages, badPages, weakPages,
    language: detectLanguage(chunks.map((c) => c.text).join(' ')),
    sections, chunkCount: saved,
  })
}

export async function processBook(id: string, profileId: string, opts: { ocr?: boolean; force?: boolean } = {}): Promise<void> {
  if (running.has(id)) return
  gone.delete(id)
  const ctrl = new AbortController()
  running.set(id, ctrl)
  docs = { ...docs } // مرجع جديد كي تُحدَّث الأزرار
  listeners.forEach((l) => l())
  try {
    await withLock(async () => {
      const latest = (await allDocs()).find((d) => d.id === id) ?? emptyDoc(id)
      if (!opts.ocr && !opts.force && (latest.status === 'done' || latest.status === 'review')) return setLocal(latest)
      let meta: DocMeta = { ...latest, status: opts.ocr ? 'ocr' : 'extracting', reason: undefined, progress: 0 }
      await saveDoc(meta)
      const blob = await getPdf(id, profileId)
      if (!blob) throw new Error('الملف غير موجود في هذا المتصفح. أضفه مرة أخرى.')
      const pdf = await import('./pdf')
      const { doc, close } = await pdf.openDoc(blob).catch((e: Error) => {
        throw new Error(e.name === 'PasswordException' ? 'الملف محمي بكلمة مرور.' : 'الملف تالف أو ليس PDF صالحاً.')
      })
      const canvas = document.createElement('canvas')
      let worker: Awaited<ReturnType<typeof import('./ocr').startOcr>> | undefined
      try {
        const ocr = opts.ocr ? await import('./ocr') : undefined
        if (ocr) {
          worker = await ocr.startOcr().catch(() => {
            throw new Error('تعذّر تشغيل التعرف الضوئي في هذا المتصفح.')
          })
        }
        const labels = await doc.getPageLabels().catch(() => null)
        const realLabels = labels?.some((l, i) => l && l !== String(i + 1)) ? labels : null
        const have = new Map((await getPages(id)).map((p) => [p.page, p]))
        for (let n = 1; n <= doc.numPages; n++) {
          if (ctrl.signal.aborted) break
          const old = have.get(n)
          const skip = old && !opts.force && (old.ok || !opts.ocr)
          if (!skip) {
            const page = await doc.getPage(n)
            let rec: PageRec = { bookId: id, page: n, lines: [], src: 'none', ok: false, label: realLabels?.[n - 1] || undefined }
            if (worker && ocr && old && !old.ok) {
              const size = page.getViewport({ scale: 1 })
              // نحو 250 نقطة للبوصة، بحد أقصى يناسب ذاكرة الهاتف
              await (await pdf.renderPage(page, canvas, Math.min(2400, size.width * 3.4))).promise
              const r = await ocr.ocrPage(worker, canvas)
              rec = { ...rec, ...r, src: 'ocr' }
            } else {
              const lines = await pdf.pageLines(page)
              rec = { ...rec, lines, src: lines.length ? 'text' : 'none', ok: textQuality(lines.map((l) => l.t).join('\n')) === 'ok' }
            }
            await putPage(rec)
            page.cleanup()
          }
          if (n % 5 === 0 || opts.ocr || n === doc.numPages) {
            meta = { ...meta, pageCount: doc.numPages, progress: n / doc.numPages }
            if (n % 20 === 0 || n === doc.numPages) await saveDoc(meta)
            else setLocal(meta)
          }
        }
        if (gone.has(id)) return
        if (ctrl.signal.aborted && !opts.ocr) {
          await saveDoc({ ...meta, status: 'none', progress: undefined, reason: 'أُوقفت المعالجة. ستكمل من حيث توقفت.' })
          return
        }
        await finish(id, meta, await pdf.bookmarks(doc))
      } finally {
        canvas.width = canvas.height = 0
        close()
        await worker?.terminate()
      }
    })
  } catch (e) {
    await saveDoc({ ...(docs[id] ?? emptyDoc(id)), status: 'failed', progress: undefined, reason: e instanceof Error && /[؀-ۿ]/.test(e.message) ? e.message : 'حدث خطأ غير متوقع أثناء المعالجة.' }).catch(() => {})
  } finally {
    running.delete(id)
    docs = { ...docs }
    listeners.forEach((l) => l())
  }
}

export function forgetDoc(id: string) {
  if (running.has(id)) gone.add(id)
  running.get(id)?.abort()
  const { [id]: _, ...rest } = docs
  docs = rest
  listeners.forEach((l) => l())
}

/** يكمل ما انقطع بإغلاق النافذة */
export async function resumePending(ids: string[], profileId: string) {
  await docsReady
  for (const id of ids) {
    const s = docs[id]?.status ?? 'none'
    if (s === 'none' || s === 'extracting' || s === 'ocr' || s === 'chunking' || s === 'indexing') await processBook(id, profileId)
  }
}
