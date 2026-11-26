import { getState } from '../../store/store'
import { getPdf } from '../books/db'
import type { DocMeta } from '../books/types'
import type { Hit } from '../rag/types'

/**
 * صور الصفحات التي أسقط التعرف الضوئي منها معادلات أو رسوماً أو جداول.
 * تُرسم من ملف PDF على الجهاز وتُرسل للمزود الذي يقرأ الصور فقط.
 */
export interface PageRef {
  bookId: string
  page: number
}
export interface PagePlan {
  /** صفحات تُرفق صورها، بالترتيب */
  attach: PageRef[]
  /** صفحات من الدرس بلا نص مقروء ولم تُرفق */
  unread: PageRef[]
  /** صفحات سقطت منها معادلات أو رسوم ولم تُرفق (تجاوزت الحد) */
  partial: PageRef[]
}
const same = (a: PageRef, b: PageRef) => a.bookId === b.bookId && a.page === b.page
const uniqPages = (list: PageRef[]) => list.filter((x, i) => list.findIndex((y) => same(x, y)) === i)

/**
 * يختار الصفحات: صفحات المقاطع الناقصة أولاً بترتيب ورودها، ثم صفحات الدرس التي لا نص لها.
 * @param range صفحات الدرس كاملة، لمعرفة ما لم يُقرأ منه
 */
export function planPages(hits: Hit[], docs: Record<string, DocMeta>, max: number, range?: { bookId: string; from: number; to: number }, symbolic?: (bookId: string) => boolean): PagePlan {
  const weak = uniqPages(hits.filter((h) => h.weak).map((h) => ({ bookId: h.bookId, page: h.page })))
  // الصفحات المصوّرة الأخرى بعدها: الأرقام والآيات والشعر المشكول تُقرأ خطأً حتى حين تبدو سليمة،
  // والمواد الرمزية (رياضيات، علوم) أولاً لأن أرقامها أساس الحل
  const others = hits.filter((h) => !h.weak && h.ocr)
  const symbolicPages = uniqPages([...others.filter((h) => symbolic?.(h.bookId)), ...others.filter((h) => !symbolic?.(h.bookId))].map((h) => ({ bookId: h.bookId, page: h.page })))
  const bad = new Set(range ? docs[range.bookId]?.badPages ?? [] : [])
  const unread: PageRef[] = range ? [...bad].filter((p) => p >= range.from && p <= range.to).sort((a, b) => a - b).map((page) => ({ bookId: range.bookId, page })) : []
  // صفحة الدرس الأولى كثيراً ما تكون صورة عنوان: لا تُقدَّم على صفحات المحتوى
  const order = [...weak, ...unread, ...symbolicPages]
  const attach = order.slice(0, max)
  return {
    attach,
    unread: unread.filter((p) => !attach.some((a) => same(a, p))),
    partial: weak.filter((p) => !attach.some((a) => same(a, p))),
  }
}

const cache = new Map<string, Promise<string | null>>()
let docCache: { bookId: string; doc: Promise<{ doc: import('pdfjs-dist/types/src/display/api').PDFDocumentProxy; close: () => void } | null> } | undefined

async function openBook(bookId: string) {
  if (docCache?.bookId !== bookId) {
    const prev = docCache
    docCache = {
      bookId,
      doc: (async () => {
        const blob = await getPdf(bookId, getState().activeId)
        if (!blob) return null
        const { openDoc } = await import('../books/pdf')
        return openDoc(blob)
      })(),
    }
    void prev?.doc.then((d) => d?.close())
  }
  return docCache.doc
}

/** صورة JPEG بعرض يكفي لقراءة الرموز الصغيرة، وحجم مقبول للإرسال */
export function pageImage(ref: PageRef, width = 1100): Promise<string | null> {
  const k = `${ref.bookId}:${ref.page}:${width}`
  if (!cache.has(k)) {
    cache.set(
      k,
      (async () => {
        try {
          const d = await openBook(ref.bookId)
          if (!d || ref.page < 1 || ref.page > d.doc.numPages) return null
          const { renderPage } = await import('../books/pdf')
          const page = await d.doc.getPage(ref.page)
          const canvas = document.createElement('canvas')
          await (await renderPage(page, canvas, width)).promise
          page.cleanup()
          const url = canvas.toDataURL('image/jpeg', 0.72)
          canvas.width = canvas.height = 0
          return url.startsWith('data:image/jpeg') ? url : null
        } catch {
          return null
        }
      })(),
    )
    // الذاكرة محدودة على الهاتف
    if (cache.size > 12) cache.delete(cache.keys().next().value!)
  }
  return cache.get(k)!
}

export async function pageImages(refs: PageRef[]): Promise<{ ref: PageRef; url: string }[]> {
  const out: { ref: PageRef; url: string }[] = []
  for (const ref of refs) {
    const url = await pageImage(ref)
    if (url) out.push({ ref, url })
  }
  return out
}
