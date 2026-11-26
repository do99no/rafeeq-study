// عرض الصفحات والتعرف الضوئي محلياً. النتائج لكل صفحة محفوظة فلا تتكرر.
// الاستخدام: node scripts/ocr-books.mjs render <جزء من الاسم> 1,2,5 عرض
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'

// الأصل في books، والبدائل الأنظف في books-alt
const allBooks = () => ['books', 'books-alt'].flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => `${d}/${f}`) : []))

const dir = (d) => new URL(`../node_modules/pdfjs-dist/${d}/`, import.meta.url).href.replace('file:///', '')
export const open = (f) => pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), cMapUrl: dir('cmaps'), cMapPacked: true, standardFontDataUrl: dir('standard_fonts'), wasmUrl: dir('wasm'), verbosity: 0 }).promise
export async function png(doc, n, width) {
  const page = await doc.getPage(n)
  const v = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / v.width })
  const c = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
  await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport }).promise
  page.cleanup()
  return c.toBuffer('image/png')
}
if (process.argv[2] === 'render') {
  mkdirSync('books-work/img', { recursive: true })
  const f = allBooks().filter((x) => x.includes(process.argv[3]))[0]
  const doc = await open(f)
  for (const n of process.argv[4].split(',').map(Number)) writeFileSync(`books-work/img/${process.argv[5] ?? 'x'}-${n}.png`, await png(doc, n, 700))
}
// node scripts/ocr-books.mjs run [جزء من الاسم]  — يكمل الصفحات الناقصة فقط، ويمكن إيقافه في أي وقت
if (process.argv[2] === 'run') {
  const { createWorker } = await import('tesseract.js')
  mkdirSync('books-work/lang', { recursive: true })
  for (const l of ['ara', 'eng']) cpSync(`node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `books-work/lang/${l}.traineddata.gz`)
  const mk = (langs) => createWorker(langs, 1, { langPath: `${process.cwd()}/books-work/lang`, cacheMethod: 'none' })
  const catalog = existsSync('books-work/catalog.json') ? JSON.parse(readFileSync('books-work/catalog.json', 'utf8')) : {}
  const jobs = []
  for (const f of allBooks().filter((x) => /\.pdf$/i.test(x) && (!process.argv[3] || x.includes(process.argv[3])))) {
    const buf = readFileSync(f)
    const id = `bk${createHash('sha256').update(buf).digest('hex').slice(0, 24)}`
    if (catalog[id]?.duplicateOf) continue
    mkdirSync(`books-work/ocr/${id}`, { recursive: true })
    const doc = await open(f)
    for (let n = 1; n <= doc.numPages; n++) if (!existsSync(`books-work/ocr/${id}/${n}.json`)) jobs.push({ f, id, n, langs: catalog[id]?.langs })
    await doc.destroy?.()
  }
  console.log('pages to do', jobs.length)
  let next = 0, done = 0
  const read = async (w, img) => {
    const { data } = await w.recognize(img, {}, { blocks: true, text: false })
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l, i) => ({ t: l.text.trim(), h: Math.round(l.bbox.y1 - l.bbox.y0), y: l.bbox.y0, c: Math.round(l.confidence), gap: i === 0 }))))
    return { confidence: data.confidence, lines }
  }
  await Promise.all(Array.from({ length: 4 }, async () => {
    const ar = await mk(['ara'])
    const own = {}
    let mix, cur, doc
    while (next < jobs.length) {
      const j = jobs[next++]
      try {
        if (cur !== j.f) { await doc?.destroy?.(); doc = await open(j.f); cur = j.f }
        const img = await png(doc, j.n, 2000)
        let r = await read(j.langs ? (own[j.langs] ??= await mk(j.langs)) : ar, img), langs = String(j.langs ?? 'ara')
        if (!j.langs && r.confidence < 82) {
          const r2 = await read((mix ??= await mk(['ara', 'eng'])), img)
          if (r2.confidence >= r.confidence + 8) { r = r2; langs = 'ara+eng' }
        }
        writeFileSync(`books-work/ocr/${j.id}/${j.n}.json`, JSON.stringify({ ...r, langs }))
      } catch (e) { console.log('FAIL', j.f, j.n, e.message) }
      if (++done % 50 === 0) console.log(new Date().toISOString().slice(11, 19), done, '/', jobs.length)
    }
  }))
  console.log('DONE')
  process.exit()
}
