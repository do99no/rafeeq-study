import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy, TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api'
import { buildLines, type Bookmark, type TextItem } from './structure'

/** يُحمّل عند الحاجة فقط (القارئ أو المعالجة). */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const asset = (dir: string) => new URL(`vendor/pdfjs/${dir}/`, document.baseURI).href

export async function openDoc(blob: Blob): Promise<{ doc: PDFDocumentProxy; close: () => void }> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  })
  return { doc: await task.promise, close: () => void task.destroy() }
}

export async function pageLines(page: PDFPageProxy) {
  const { items } = await page.getTextContent()
  const flat: TextItem[] = items
    .filter((i): i is PdfTextItem => 'str' in i)
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10 }))
  return buildLines(flat)
}

export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number) {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  canvas.dir = 'ltr' // وراثة RTL تشوّه مواضع الحروف العربية
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const task = page.render({ canvas, viewport })
  return task
}

export async function bookmarks(doc: PDFDocumentProxy): Promise<Bookmark[]> {
  const out: Bookmark[] = []
  type Node = { title: string; dest: string | unknown[] | null; items: Node[] }
  const walk = async (nodes: Node[], level: 1 | 2) => {
    for (const n of nodes) {
      try {
        const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest
        const ref = dest?.[0]
        if (ref != null && n.title.trim()) {
          const page = typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref as { num: number; gen: number })) + 1
          out.push({ title: n.title.trim(), level, page })
        }
      } catch {
        /* علامة تالفة */
      }
      if (n.items?.length) await walk(n.items, 2)
    }
  }
  const outline = (await doc.getOutline().catch(() => null)) as Node[] | null
  if (outline) {
    // كثير من الملفات تلف كل العلامات داخل جذر واحد
    const roots = outline.length === 1 && outline[0].items.length > 1 ? outline[0].items : outline
    await walk(roots, 1)
  }
  return out.filter((b, i) => i === 0 || b.page >= out[i - 1].page)
}
