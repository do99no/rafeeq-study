// إعادة التعرف الضوئي لصفحات محددة ثبت فقد محتواها (تظليل ملون، إطارات زخرفية)، بعد تحويل الصفحة إلى أبيض وأسود.
// لا يكتب النتيجة الجديدة إلا إذا اجتازت قاعدة الجودة نفسها (judgeOcr)، ويحتفظ بنسخة من الملف القديم.
// node scripts/reocr-pages.mjs <bookId> <page,page,...> [ara|ara+eng]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createServer } from 'vite'
import { open, png } from './ocr-books.mjs'

const [bookId, list, langs = 'ara'] = process.argv.slice(2)
const report = JSON.parse(readFileSync('books-work/report.json', 'utf8')).find((r) => r.id === bookId && !r.note)
if (!report) throw new Error('unknown book')
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const st = await vite.ssrLoadModule('/src/services/books/structure.ts')
const { createWorker } = await import('tesseract.js')
const w = await createWorker(langs.split('+'), 1, { langPath: `${process.cwd()}/books-work/lang`, cacheMethod: 'none' })
const doc = await open(report.file)
mkdirSync(`books-work/ocr-backup/${bookId}`, { recursive: true })

/** أبيض وأسود بعتبة: التظليل الفاتح (أزرق أو رمادي) يصبح أبيض، والنص الداكن يبقى */
async function binarize(buf, threshold) {
  const img = await loadImage(buf)
  const c = createCanvas(img.width, img.height)
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height)
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, g, b] = [d.data[i], d.data[i + 1], d.data[i + 2]]
    // النص الملون (أحمر أو أزرق داكن) يبقى: نعتمد على أدكن قناة
    const v = Math.min(r, g, b) < threshold && (r + g + b) / 3 < threshold + 40 ? 0 : 255
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v
  }
  x.putImageData(d, 0, 0)
  return c.toBuffer('image/png')
}
const read = async (img) => {
  const { data } = await w.recognize(img, {}, { blocks: true, text: false })
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l, i) => ({ t: l.text.trim(), h: Math.round(l.bbox.y1 - l.bbox.y0), y: l.bbox.y0, c: Math.round(l.confidence), gap: i === 0 }))))
  return { confidence: data.confidence, lines }
}

for (const n of list.split(',').map(Number)) {
  const file = `books-work/ocr/${bookId}/${n}.json`
  const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const oldJ = old ? st.judgeOcr(old.lines) : { ok: false, lines: [] }
  const raw = await png(doc, n, 2400)
  let best = null
  for (const th of [150, 175, 200]) {
    const r = await read(await binarize(raw, th))
    const j = st.judgeOcr(r.lines)
    const size = j.lines.reduce((s, l) => s + l.t.length, 0)
    if (j.ok && (!best || size > best.size)) best = { r, j, th, size }
  }
  const oldSize = oldJ.lines.reduce((s, l) => s + l.t.length, 0)
  if (best && (!oldJ.ok || best.size > oldSize * 1.2)) {
    if (old) copyFileSync(file, `books-work/ocr-backup/${bookId}/${n}.json`)
    writeFileSync(file, JSON.stringify({ ...best.r, langs, preprocess: `binarize-${best.th}` }))
    console.log(`p${n}: REPLACED (threshold ${best.th}) chars ${oldSize} → ${best.size}, conf ${Math.round(best.r.confidence)}`)
  } else console.log(`p${n}: kept (${best ? `new ${best.size} chars not better` : 'no readable result'}; old ok=${oldJ.ok} chars ${oldSize})`)
}
await w.terminate()
await vite.close()
process.exit(0)
