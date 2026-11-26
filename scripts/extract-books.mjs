// يستخرج كتب مجلد books بمحرك الموقع نفسه ويكتب تقريراً في books-work (غير مرفوع).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

// الأصل في books، والبدائل الأنظف في books-alt
const allBooks = () => ['books', 'books-alt'].flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => `${d}/${f}`) : []))

const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const st = await vite.ssrLoadModule('/src/services/books/structure.ts')
mkdirSync('books-work', { recursive: true })
const only = process.argv[2]
const dir = (d) => new URL(`../node_modules/pdfjs-dist/${d}/`, import.meta.url).href.replace('file:///', '')
for (const f of allBooks().filter((x) => /\.pdf$/i.test(x) && (!only || x.includes(only)))) {
  const buf = readFileSync(f)
  const id = `bk${createHash('sha256').update(buf).digest('hex').slice(0, 24)}`
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: dir('cmaps'), cMapPacked: true, standardFontDataUrl: dir('standard_fonts'), verbosity: 0 }).promise
  const meta = await doc.getMetadata().catch(() => ({ info: {} }))
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const { items } = await page.getTextContent()
    const lines = st.buildLines(items.filter((i) => 'str' in i).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10 })))
    const q = st.textQuality(lines.map((l) => l.t).join('\n'))
    pages.push({ bookId: id, page: n, lines, src: lines.length ? 'text' : 'none', ok: q === 'ok', q })
    page.cleanup()
  }
  const outline = await doc.getOutline().catch(() => null)
  writeFileSync(`books-work/${id}.json`, JSON.stringify({ id, file: f, pages }))
  const c = (q) => pages.filter((p) => p.q === q).length
  console.log(`${f}\n  id=${id} pages=${doc.numPages} ok=${c('ok')} broken=${c('broken')} empty=${c('empty')} outline=${outline?.length ?? 0} producer=${meta.info.Producer ?? ''}`)
  const mid = pages[Math.floor(pages.length * 0.4)]
  console.log('  sample p' + mid.page + ': ' + mid.lines.slice(0, 6).map((l) => l.t).join(' / ').slice(0, 260))
}
await vite.close()
