// يكتب لكل كتاب ملخص صفحاته (أول الأسطر والرقم المطبوع) وصفحات الفهرس كاملة، لبناء قوائم الدروس يدوياً.
// node scripts/toc-dump.mjs   →  books-work/toc-dump/<id>.txt
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const W = 'books-work'
const catalog = JSON.parse(readFileSync(`${W}/catalog.json`, 'utf8'))
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const st = await vite.ssrLoadModule('/src/services/books/structure.ts')
mkdirSync(`${W}/toc-dump`, { recursive: true })
const files = ['books', 'books-alt'].flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => `${d}/${f}`) : [])).filter((f) => /\.pdf$/i.test(f))
for (const f of files) {
  const id = `bk${createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 24)}`
  const c = catalog[id]
  if (!c || c.duplicateOf) continue
  const text = JSON.parse(readFileSync(`${W}/${id}.json`, 'utf8')).pages
  const pages = text.map((p) => {
    const of = `${W}/ocr/${id}/${p.page}.json`
    if (c.useText) return { bookId: id, page: p.page, lines: p.lines, src: 'text', ok: true }
    if (!existsSync(of)) return { bookId: id, page: p.page, lines: [], src: 'none', ok: false }
    // الأسطر كلها هنا (حتى الضعيفة) لأن الفهرس كثير الأرقام
    const lines = JSON.parse(readFileSync(of, 'utf8')).lines.map((l) => ({ ...l, t: st.clean ? st.clean(l.t) : l.t }))
    return { bookId: id, page: p.page, lines, src: 'ocr', ok: true }
  })
  const { printed } = st.analyze(id, pages.map((p) => ({ ...p, lines: st.judgeOcr ? (p.src === 'ocr' ? st.judgeOcr(p.lines).lines : p.lines) : p.lines })), [])
  const out = [`# ${c.title} | ${id} | ${pages.length} صفحة`, '']
  for (const p of pages) {
    const toc = p.lines.filter((l) => /[0-9٠-٩]{1,3}\s*$|^\s*[0-9٠-٩]{1,3}\s/.test(l.t)).length >= 5 || p.lines.some((l) => /الفهرس|المحتويات|فهرس|contents/i.test(l.t))
    out.push(`== PDF ${p.page} | مطبوع ${printed.get(p.page) ?? '-'}${toc ? ' | فهرس؟' : ''} ==`)
    out.push(...(toc ? p.lines : p.lines.slice(0, 5)).map((l) => `  ${l.t}${l.h ? `  {h${l.h}}` : ''}`))
  }
  writeFileSync(`${W}/toc-dump/${id}.txt`, out.join('\n'))
  console.log(id, c.title, pages.length)
}
await vite.close()
