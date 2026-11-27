// تدقيق صفحات الرياضيات صفحةً صفحة من صورها (لا من القراءة الآلية)، عبر خادم رفيق بجلسة المسؤول (Gemini المجاني).
// الاستخدام: RAFEEQ_ADMIN_TOKEN=... node scripts/audit-math-pages.mjs
// النتائج: books-work/math-audit/<bookId>.json (تُستأنف من آخر صفحة)، ثم docs/MATH-AUDIT.md.
// ما يبلغ عنه النموذج «خطأ» لا يُعتمد حتى يُراجع بشرياً ويُضاف إلى src/data/errata.ts.
import fs from 'fs'
import { createCanvas } from '@napi-rs/canvas'
import { open } from './ocr-books.mjs'

const W = process.env.RAFEEQ_WORKER ?? 'https://rafeeq-ai.rafeeq-study.workers.dev'
const TOKEN = process.env.RAFEEQ_ADMIN_TOKEN
if (!TOKEN) throw new Error('RAFEEQ_ADMIN_TOKEN')
const BOOKS = [
  { id: 'bk1475753db2db628794607b1d', title: 'الرياضيات الأساسية', file: 'books-alt/الرياضيات الأساسية.pdf' },
  { id: 'bk6068fbdad88cf2d38e8e9ccf', title: 'الرياضيات المتخصصة - الكتاب الأول', file: 'books/كتاب الرياضيات المتخصصة - الكتاب الثاني - الثالث الثانوي.pdf' },
  { id: 'bkb38978d16c1ba061ca289721', title: 'الرياضيات المتخصصة - الكتاب الثاني', file: 'books/كتاب الرياضيات المتخصصة - الكتاب الأول - الثالث الثانوي.pdf' },
]
// صفحات بلا محتوى دراسي (فُحصت بصرياً: غلاف، ردمك، عناوين وحدات، أهداف، صفحة بيضاء)
const SKIP = { bk1475753db2db628794607b1d: [1, 6, 8, 36, 64, 73, 118, 146], bk6068fbdad88cf2d38e8e9ccf: [3, 52, 86, 101, 136], bkb38978d16c1ba061ca289721: [3, 7, 47, 77, 105, 130, 152, 173] }
const ONLY = process.env.ONLY_BOOK
const sl = (ms) => new Promise((r) => setTimeout(r, ms))

async function jpeg(doc, n) {
  const page = await doc.getPage(n)
  const v0 = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: 1300 / v0.width })
  const c = createCanvas(viewport.width, viewport.height)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvas: c, canvasContext: ctx, viewport }).promise
  page.cleanup()
  return 'data:image/jpeg;base64,' + c.toBuffer('image/jpeg', 78).toString('base64')
}

const SYSTEM = `أنت مدقق رياضيات دقيق يراجع صفحات كتاب مدرسي سوداني (الصف الثالث الثانوي) من صورها. لا تخمّن ولا تكتب شيئاً لم تره في الصورة.`
const ASK = (pages) => `أُرفقت صورة الصفحة ${pages[0]}. اعمل على مرحلتين منفصلتين:

المرحلة ١ (نسخ حرفي): انسخ كل معادلة وكل ناتج وكل صف في الجداول كما هو مطبوع في الصورة بالضبط، رمزاً رمزاً وإشارةً إشارة، حتى لو بدا خطأً واضحاً. لا تصحح شيئاً أثناء النسخ، ولا تضف إشارة أو رقماً غير موجود. انتبه خاصة لإشارة السالب قبل الحدود، ولأرقام الجداول في كل عمود.

المرحلة ٢ (تحقق): لكل سطر نسخته، أعد حسابه بنفسك من معطياته (لكل صف في جدول: احسب كل عمود من الأعمدة التي قبله)، وقارن بما نسخته حرفياً.

أخرج JSON فقط:
{"pages":[{"page":${pages[0]},"type":"شرح|مثال محلول|تمارين|جدول|مختلط","exercises":عدد التمارين بلا حلول,"checks":[{"what":"وصف العنصر","book":"النص المنسوخ حرفياً من الصورة","verdict":"ok|error|unclear","correct":"الصحيح إن اختلف","why":"حسابك"}]}]}
"error" إذا اختلف المنسوخ حرفياً عن حسابك، و"unclear" إذا لم تكن الصورة واضحة.`

async function chat(images, pages) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(W + '/chat', {
      method: 'POST',
      headers: { authorization: `Bearer s:${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'auto', maxTokens: 12000, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: ASK(pages), images }] }),
    }).catch(() => null)
    if (!res?.ok) {
      const j = res ? await res.json().catch(() => ({})) : {}
      const wait = Math.min(600, Number(j.retryAfter) || 60 * (attempt + 1))
      console.log(`  service ${res?.status ?? 'network'} ${j.code ?? ''}; waiting ${wait}s`)
      await sl(wait * 1000)
      continue
    }
    let text = ''
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue
        try {
          text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? ''
        } catch {}
      }
    }
    const s = text.indexOf('{'), e = text.lastIndexOf('}')
    try {
      return JSON.parse(text.slice(s, e + 1))
    } catch {
      console.log('  bad JSON; retry')
    }
  }
  return null
}

fs.mkdirSync('books-work/math-audit', { recursive: true })
for (const b of BOOKS) {
  if (ONLY && b.id !== ONLY) continue
  const f = `books-work/math-audit/${b.id}.json`
  const done = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}
  const doc = await open(b.file)
  const todo = []
  const PAGES = process.env.PAGES ? process.env.PAGES.split(",").map(Number) : null
  for (let n = 1; n <= doc.numPages; n++) if ((PAGES ? PAGES.includes(n) : !done[n]) && !SKIP[b.id].includes(n)) todo.push(n)
  console.log(`${b.title}: ${doc.numPages} pages, ${Object.keys(done).length} done, ${todo.length} to go`)
  const LIMIT = Number(process.env.LIMIT) || Infinity
  for (let i = 0; i < Math.min(todo.length, LIMIT); i += 1) {
    const pages = todo.slice(i, i + 1)
    const images = []
    for (const n of pages) images.push(await jpeg(doc, n))
    const r = await chat(images, pages)
    if (!r) {
      console.log('  stopped: service unavailable; resume later')
      process.exit(2)
    }
    const list = Array.isArray(r.pages) ? r.pages : []
    pages.forEach((n, k) => {
      const p = list.find((x) => Number(x?.page) === n) ?? list[k]
      done[n] = { type: String(p?.type ?? ''), exercises: Number(p?.exercises) || 0, checks: Array.isArray(p?.checks) ? p.checks : [], at: Date.now() }
    })
    fs.writeFileSync(f, JSON.stringify(done, null, 1))
    const errs = pages.flatMap((n) => done[n].checks.filter((c) => c.verdict === 'error').map((c) => `p${n}: ${c.what}`))
    console.log(`  ${b.title} ${pages.join(',')}: ${pages.map((n) => done[n].checks.length).join('+')} checks${errs.length ? ' | ERR ' + errs.join(' ; ') : ''}`)
    await sl(4000)
  }
}
console.log('all done')
