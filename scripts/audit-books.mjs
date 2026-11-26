// تدقيق الكتب الخمسة عشر: الصفحات، النص، المعادلات، الترتيب، الفهارس، وسلامة الملفات المشفرة المنشورة.
// node scripts/audit-books.mjs  → books-work/audit.json (محلي، لا يُرفع)
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createServer } from 'vite'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const W = 'books-work'
const catalog = JSON.parse(readFileSync(`${W}/catalog.json`, 'utf8'))
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const st = await vite.ssrLoadModule('/src/services/books/structure.ts')
const sha = (b) => createHash('sha256').update(b).digest('hex')

const code = readFileSync(`${W}/library-code.txt`, 'utf8').trim()
const info = JSON.parse(readFileSync('public/library/info.json', 'utf8'))
const key = pbkdf2Sync(code, Buffer.from(info.salt, 'base64'), info.rounds, 32, 'sha256')
const unseal = (buf) => {
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])
}
const splitPack = (buf) => {
  if (buf.subarray(0, 8).toString() !== 'RAFEEQ01') throw new Error('magic')
  const n = buf.readUInt32BE(8)
  return { head: JSON.parse(gunzipSync(buf.subarray(12, 12 + n))), pdf: buf.subarray(12 + n) }
}
const pdfPages = async (bytes) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  // الصفحة الأولى والأخيرة تُفتحان فعلاً
  await doc.getPage(1)
  await doc.getPage(doc.numPages)
  const n = doc.numPages
  await doc.cleanup?.()
  return n
}
const manifest = JSON.parse(unseal(readFileSync('public/library/manifest.bin')))

const words = (t) => t.match(/[\p{L}]+/gu) ?? []
const grams = (t) => { const w = words(t); const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(' ')); return s }
const jac = (a, b) => { if (a.size < 15 || b.size < 15) return 0; let x = 0; for (const g of a) if (b.has(g)) x++; return x / (a.size + b.size - x) }

const out = []
for (const m of manifest) {
  const c = catalog[m.id]
  const r = { id: m.id, title: m.title, subject: m.subject, problems: [] }
  // ١. الحزمة المحلية: PDF الأصلي + الفهرس الحالي
  const local = splitPack(readFileSync(`${W}/packs/${m.title}.rafeeq`))
  const { meta, pages, chunks } = local.head
  r.pdfSha = sha(local.pdf)
  if (`bk${r.pdfSha.slice(0, 24)}` !== m.id) r.problems.push('PDF المحلي لا يطابق معرّف الكتاب')
  r.pdfPages = await pdfPages(local.pdf)
  r.metaPages = meta.pageCount
  r.pageRecords = pages.length
  if (r.pdfPages !== meta.pageCount || pages.length !== meta.pageCount) r.problems.push(`عدد الصفحات غير متطابق: PDF ${r.pdfPages}، الفهرس ${meta.pageCount}، السجلات ${pages.length}`)
  const nums = pages.map((p) => p.page)
  r.missingRecords = Array.from({ length: r.pdfPages }, (_, i) => i + 1).filter((n) => !nums.includes(n))
  r.dupRecords = nums.filter((n, i) => nums.indexOf(n) !== i)

  // ٢. الصفحات: مفهرسة، غير مفهرسة وسببها، وصفحات سقطت منها معادلات أو رسوم
  const chunkPages = new Set(chunks.map((x) => x.page))
  r.chunks = chunks.length
  r.indexedPages = chunkPages.size
  r.notIndexed = []
  let conf = 0, confN = 0, lowKept = 0, eqKept = 0, dropped = 0, mixed = 0, single = 0, tok = 0
  const ocrConf = {}
  for (const p of pages) {
    const of = `${W}/ocr/${m.id}/${p.page}.json`
    const raw = existsSync(of) ? JSON.parse(readFileSync(of, 'utf8')).lines : null
    if (raw) {
      const kept = new Set(p.lines.map((l) => l.t))
      for (const l of raw) {
        const t = st.clean(l.t).replace(/\s+/g, ' ').trim()
        if (!t) continue
        if (kept.has(t)) { conf += l.c * t.length; confN += t.length; if (l.c < 70) lowKept++ }
      }
      const j = st.judgeOcr(raw)
      const s = j.lines.reduce((a, l) => a + l.t.length, 0)
      ocrConf[p.page] = j.ok
      dropped += raw.length - j.lines.length
      void s
    }
    for (const l of p.lines) {
      if (/[=+×÷√→⟶⇌]|\d\s*[a-zA-Z]{1,2}\d/.test(l.t)) eqKept++
      for (const w of words(l.t)) { tok++; if (/[ء-ي]/.test(w) && /[A-Za-z]/.test(w)) mixed++; if (/^[ء-ي]$/.test(w) && w !== 'و') single++ }
    }
    if (!chunkPages.has(p.page)) {
      const why = c.skip?.includes(p.page) ? 'غلاف' : p.src === 'none' ? (raw ? 'نص غير مقروء' : 'بلا تعرّف ضوئي') : !p.ok ? (st.textQuality(p.lines.map((l) => l.t).join('\n')) === 'empty' ? 'صفحة شبه فارغة أو صورة' : 'ثقة القراءة منخفضة (معادلات أو رسوم غالباً)') : 'نص قليل جداً'
      r.notIndexed.push({ page: p.page, why })
    }
  }
  r.notIndexedWhy = r.notIndexed.reduce((a, x) => ({ ...a, [x.why]: (a[x.why] ?? 0) + 1 }), {})
  r.weakPages = pages.filter((p) => p.ok && p.weak).length
  r.weakList = pages.filter((p) => p.ok && p.weak).map((p) => p.page)
  r.droppedLines = dropped
  r.avgConf = confN ? Math.round(conf / confN) : null
  r.lowConfKeptLines = lowKept
  r.equationLinesKept = eqKept
  r.tokens = tok
  r.mixedScriptTokens = mixed
  r.singleLetterTokens = single
  r.language = meta.language
  r.src = { text: meta.textPages, ocr: meta.ocrPages }

  // ٣. الترتيب والتكرار: صفحات متطابقة النص، وقفزات أرقام الصفحات المطبوعة
  const byPage = new Map()
  for (const x of chunks) byPage.set(x.page, (byPage.get(x.page) ?? '') + ' ' + x.text)
  const g = [...byPage].map(([p, t]) => [p, grams(t)])
  r.duplicatePages = []
  for (let i = 0; i < g.length; i++) for (let k = i + 1; k < g.length; k++) { const s = jac(g[i][1], g[k][1]); if (s > 0.6) r.duplicatePages.push([g[i][0], g[k][0], Math.round(s * 100)]) }
  const printed = [...new Map(chunks.filter((x) => x.printed).map((x) => [x.page, x.printed])).entries()].map(([p, n]) => [p, Number(String(n).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660))]).sort((a, b) => a[0] - b[0])
  r.printedMapped = printed.length
  r.printedJumps = []
  for (let i = 1; i < printed.length; i++) { const dp = printed[i][0] - printed[i - 1][0], dn = printed[i][1] - printed[i - 1][1]; if (dn !== dp && dp <= 3) r.printedJumps.push(`${printed[i - 1][0]}(${printed[i - 1][1]})→${printed[i][0]}(${printed[i][1]})`) }

  // ٤. فهرس الدروس: الترتيب، المدى، وكم من كل درس مقروء
  const secs = meta.sections
  r.sections = secs.length
  r.units = secs.filter((s) => s.level === 1).length
  r.lessons = secs.filter((s) => s.level === 2).length
  r.tocOrder = secs.every((s, i) => i === 0 || s.page >= secs[i - 1].page) && secs.every((s) => s.page >= 1 && s.page <= r.pdfPages && s.endPage >= s.page && s.endPage <= r.pdfPages)
  if (!r.tocOrder) r.problems.push('ترتيب الفهرس أو مداه غير صحيح')
  r.lessonCoverage = secs.map((s) => {
    const span = s.endPage - s.page + 1
    const read = Array.from({ length: span }, (_, i) => s.page + i).filter((p) => chunkPages.has(p)).length
    const n = chunks.filter((x) => x.page >= s.page && x.page <= s.endPage).length
    const weak = Array.from({ length: span }, (_, i) => s.page + i).filter((p) => r.weakList.includes(p)).length
    return { title: s.title, level: s.level, from: s.page, to: s.endPage, pages: span, readable: read, weak, chunks: n }
  })
  r.emptyLessons = r.lessonCoverage.filter((x) => !x.chunks).map((x) => x.title)
  r.lowCoverage = r.lessonCoverage.filter((x) => x.chunks && x.readable / x.pages < 0.6).map((x) => `${x.title} (${x.readable}/${x.pages})`)
  r.chunkSectionMismatch = chunks.filter((x) => x.sectionId && !secs.some((s) => s.id === x.sectionId)).length
  r.chunksOutsideLessons = secs.length ? chunks.filter((x) => !x.sectionId).length : null

  // ٥. الملفات المشفرة المنشورة: تُفك وتُطابق مع الأصل
  const pub = readFileSync(`public/library/${m.file}`)
  r.pub = { file: m.file, size: pub.length, sha: sha(pub) }
  try {
    const full = splitPack(unseal(pub))
    r.pub.pdfMatches = sha(full.pdf) === r.pdfSha
    r.pub.readerPages = await pdfPages(full.pdf)
    r.pub.packV = full.head.meta.v ?? null
    if (!r.pub.pdfMatches) r.problems.push('PDF المنشور لا يطابق الأصل')
  } catch (e) { r.problems.push(`تعذّر فك الحزمة المنشورة: ${e.message}`) }
  const idx = readFileSync(`public/library/${m.idx}`)
  r.pub.idx = { file: m.idx, size: idx.length, sha: sha(idx) }
  try {
    const h = JSON.parse(gunzipSync(unseal(idx)))
    r.pub.idx.v = h.meta.v
    r.pub.idx.matchesLocal = h.meta.v === meta.v && h.meta.v === m.v && h.chunks.length === chunks.length && JSON.stringify(h.meta.sections) === JSON.stringify(secs)
    if (!r.pub.idx.matchesLocal) r.problems.push('ملف الفهرس المنشور لا يطابق الفهرس المحلي')
  } catch (e) { r.problems.push(`تعذّر فك ملف الفهرس: ${e.message}`) }
  out.push(r)
  console.log(`${m.title}: PDF ${r.pdfPages} | مفهرسة ${r.indexedPages} | غير مفهرسة ${r.notIndexed.length} ${JSON.stringify(r.notIndexedWhy)} | سقطت منها معادلات/رسوم ${r.weakPages} | مقاطع ${r.chunks} | ثقة ${r.avgConf} | دروس ${r.units}+${r.lessons} | فارغة ${r.emptyLessons.length} | ضعيفة التغطية ${r.lowCoverage.length} | تكرار ${r.duplicatePages.length} | قفزات ${r.printedJumps.length}/${r.printedMapped} | منشور ${r.pub.pdfMatches && r.pub.idx.matchesLocal ? 'سليم' : 'خلل'} | مشكلات ${r.problems.length}`)
}
writeFileSync(`${W}/audit.json`, JSON.stringify({ at: new Date().toISOString(), manifest: manifest.length, books: out }, null, 1))
await vite.close()
