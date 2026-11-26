// يبني حزم الكتب من نتائج OCR ثم يشفرها إلى public/library. لا يكتب نصاً مقروءاً خارج books-work.
// node scripts/pack-books.mjs
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'

// الأصل في books، والبدائل الأنظف في books-alt
const allBooks = () => ['books', 'books-alt'].flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => `${d}/${f}`) : []))

const W = 'books-work'
// معلومات الكتب (عناوين من الأغلفة) محلية أيضاً
const catalog = JSON.parse(readFileSync(`${W}/catalog.json`, 'utf8'))
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const st = await vite.ssrLoadModule('/src/services/books/structure.ts')
mkdirSync('public/library', { recursive: true })
mkdirSync(`${W}/packs`, { recursive: true })

const codeFile = `${W}/library-code.txt`
if (!existsSync(codeFile)) {
  const abc = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
  const pick = () => { for (;;) { const b = randomBytes(1)[0]; if (b < 240) return abc[b % 30] } }
  writeFileSync(codeFile, Array.from({ length: 6 }, () => Array.from({ length: 4 }, pick).join('')).join('-') + '\n')
}
const code = readFileSync(codeFile, 'utf8').trim()
const infoFile = 'public/library/info.json'
const info = existsSync(infoFile) ? JSON.parse(readFileSync(infoFile, 'utf8')) : { v: 1, salt: randomBytes(16).toString('base64'), rounds: 600000 }
writeFileSync(infoFile, JSON.stringify(info))
const key = pbkdf2Sync(code, Buffer.from(info.salt, 'base64'), info.rounds, 32, 'sha256')
const seal = (buf) => {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()])
}
const cacheFile = `${W}/sealed.json`
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
const report = []
const manifest = []
const keep = new Set(['info.json', 'manifest.bin'])

for (const f of allBooks().filter((x) => /\.pdf$/i.test(x))) {
  const pdf = readFileSync(f)
  const id = `bk${createHash('sha256').update(pdf).digest('hex').slice(0, 24)}`
  const c = catalog[id]
  if (!c || c.duplicateOf) { report.push({ file: f, id, note: c?.duplicateOf ? 'مكرر' : 'غير مدرج' }); continue }
  const text = JSON.parse(readFileSync(`${W}/${id}.json`, 'utf8')).pages
  const pages = text.map((p) => {
    const of = `${W}/ocr/${id}/${p.page}.json`
    if (c.useText && st.textQuality(p.lines.map((l) => l.t).join('\n')) === 'ok') return { bookId: id, page: p.page, lines: p.lines, src: 'text', ok: true }
    if (c.skip?.includes(p.page) || !existsSync(of)) return { bookId: id, page: p.page, lines: [], src: 'none', ok: false }
    const j = st.judgeOcr(JSON.parse(readFileSync(of, 'utf8')).lines)
    return { bookId: id, page: p.page, lines: j.lines, src: 'ocr', ok: j.ok, ...(j.weak ? { weak: j.weak } : {}) }
  })
  // قوائم الدروس من فهارس الكتب، وكل بند فيها متحقق منه على صفحته (books-work/toc)
  const tocFile = `${W}/toc/${id}.json`
  const toc = existsSync(tocFile) ? JSON.parse(readFileSync(tocFile, 'utf8')).sections.filter((x) => !x.unverified) : c.sections ?? []
  const { sections, chunks, printed } = st.analyze(id, pages, toc)
  const bad = pages.filter((p) => !p.ok).map((p) => p.page)
  const meta = {
    id, status: bad.length > Math.max(2, pages.length * 0.1) ? 'review' : 'done', pageCount: pages.length,
    textPages: pages.filter((p) => p.ok && p.src === 'text').length, ocrPages: pages.filter((p) => p.ok && p.src === 'ocr').length,
    badPages: bad, weakPages: pages.filter((p) => p.ok && p.weak).map((p) => p.page),
    language: st.detectLanguage(chunks.map((x) => x.text).join(' ')), sections, chunkCount: chunks.length,
  }
  if (meta.status === 'review') meta.reason = 'صفحات كثيرة لم يُقرأ نصها بجودة كافية (معادلات أو رسومات غالباً)، ولم تدخل البحث. صورها متاحة في القارئ.'
  // نسخة الفهرس: تتغير عند أي تعديل في الدروس أو المقاطع، فيُحدَّث الكتاب دون إعادة تنزيل PDF
  const v = createHash('sha256').update(JSON.stringify({ meta, chunks })).digest('hex').slice(0, 12)
  meta.v = v
  const head = gzipSync(JSON.stringify({ title: c.title, subject: c.subject, meta, pages, chunks }))
  const size = Buffer.alloc(4)
  size.writeUInt32BE(head.length)
  const pack = Buffer.concat([Buffer.from('RAFEEQ01'), size, head, pdf])
  writeFileSync(`${W}/packs/${c.title}.rafeeq`, pack)
  const sum = createHash('sha256').update(pack).digest('hex')
  // ملف PDF المشفر لا يُعاد إلا إذا غاب: تحديثات الفهرس تصل عبر ملف idx الصغير
  if (!cache[id]?.file || !existsSync(`public/library/${cache[id].file}`)) {
    const name = `${randomBytes(8).toString('hex')}.bin`
    writeFileSync(`public/library/${name}`, seal(pack))
    cache[id] = { ...cache[id], sum, file: name, size: pack.length }
  }
  // الفهرس وحده (دون PDF) لتحديث الكتب المنزّلة
  if (cache[id].v !== v || !cache[id].idx || !existsSync(`public/library/${cache[id].idx}`)) {
    const idx = `${randomBytes(8).toString('hex')}.bin`
    writeFileSync(`public/library/${idx}`, seal(head))
    cache[id] = { ...cache[id], v, idx }
  }
  keep.add(cache[id].file)
  keep.add(cache[id].idx)
  manifest.push({ id, title: c.title, subject: c.subject, file: cache[id].file, size: cache[id].size ?? pack.length, pages: meta.pageCount, chunks: meta.chunkCount, v, idx: cache[id].idx, idxSize: head.length })
  report.push({ file: f, id, ...c, pages: meta.pageCount, text: meta.textPages, ocr: meta.ocrPages, bad, weak: meta.weakPages, chunks: chunks.length, sections: sections.length, printed: printed.size, status: meta.status })
}
const mjson = JSON.stringify(manifest)
if (cache.manifest !== mjson || !existsSync('public/library/manifest.bin')) {
  writeFileSync('public/library/manifest.bin', seal(Buffer.from(mjson)))
  cache.manifest = mjson
}
writeFileSync(cacheFile, JSON.stringify(cache))
for (const x of readdirSync('public/library')) if (!keep.has(x)) unlinkSync(`public/library/${x}`) // نسخ مشفرة قديمة ولّدها هذا السكربت
writeFileSync(`${W}/report.json`, JSON.stringify(report, null, 1))
for (const r of report) console.log(r.note ? `${r.file}: ${r.note}` : `${r.title} | صفحات ${r.pages} | نص ${r.text} | OCR ${r.ocr} | غير مفهرسة ${r.bad.length} | ناقصة ${r.weak.length} | مقاطع ${r.chunks} | عناوين ${r.sections} | مطبوع ${r.printed}`)
await vite.close()
