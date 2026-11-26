import { createWorker, type Worker } from 'tesseract.js'
import { judgeOcr } from './structure'

const base = () => new URL('vendor/ocr', document.baseURI).href
const make = (langs: string[]) =>
  createWorker(langs, 1, { workerPath: `${base()}/worker.min.js`, corePath: base(), langPath: base(), workerBlobURL: false })

export interface Ocr {
  ar: Worker
  mix?: Worker
  terminate: () => Promise<void>
}
export async function startOcr(): Promise<Ocr> {
  const o: Ocr = {
    ar: await make(['ara']),
    terminate: async () => {
      await o.ar.terminate()
      await o.mix?.terminate()
    },
  }
  return o
}

async function read(w: Worker, canvas: HTMLCanvasElement) {
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false })
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l, i) => ({ t: l.text, h: l.bbox.y1 - l.bbox.y0, c: l.confidence, gap: i === 0 }))))
  return { confidence: data.confidence, lines }
}

/** العربية وحدها أدق؛ نضيف الإنجليزية فقط إذا حسّنت الصفحة بوضوح. */
export async function ocrPage(o: Ocr, canvas: HTMLCanvasElement) {
  let r = await read(o.ar, canvas)
  if (r.confidence < 82) {
    const r2 = await read((o.mix ??= await make(['ara', 'eng'])), canvas)
    if (r2.confidence >= r.confidence + 8) r = r2
  }
  return judgeOcr(r.lines)
}
