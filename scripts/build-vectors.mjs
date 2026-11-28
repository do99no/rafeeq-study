// متجهات البحث الدلالي لكل كتاب، تُحسب مرة واحدة وتُنشر ملفات ثابتة (public/library/vec/<bookId>.bin)
// بدل أن يحسبها كل جهاز بنفسه (ميغابايتات من JSON وحصة Gemini في كل جهاز جديد).
//
// node scripts/build-vectors.mjs   (يحتاج books-work/library-code.txt وكلمة المسؤول في worker/.local؛ لا يطبع أسراراً)
//
// الصيغة: "RVEC1" + طول الرأس (4 بايت) + رأس JSON {model, dims, n} + n×8 بايت بصمة نص الإدخال (SHA-256) + n×dims بايت (int8 = round(v×127))
// المتصفح يستعمل الملف فقط إن طابقت بصمات كل المقاطع نصوصه الحالية، وإلا يكمل بالحساب المباشر كما كان.
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const W = 'https://rafeeq-ai.rafeeq-study.workers.dev'
const ORIGIN = 'https://do99no.github.io'
const code = readFileSync('books-work/library-code.txt', 'utf8').trim()
const info = JSON.parse(readFileSync('public/library/info.json', 'utf8'))
const key = pbkdf2Sync(code, Buffer.from(info.salt, 'base64'), info.rounds, 32, 'sha256')
const unseal = (buf) => {
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])
}
const manifest = JSON.parse(unseal(readFileSync('public/library/manifest.bin')))

const b64u = (b) => Buffer.from(b).toString('base64url')
const unb64u = (s) => Buffer.from(s, 'base64url')
const call = async (path, { tok, body }) => {
  const r = await fetch(W + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer s:' + tok } : {}) }, body: JSON.stringify(body) })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
const PW = readFileSync('worker/.local/production-credentials.txt', 'utf8').match(/المسؤول[^:]*: (\S+)/)[1]
const salt = (await call('/auth/salt', { body: { id: 'admin' } })).j
const tok = (await call('/auth/login', { body: { id: 'admin', ...(salt.legacy ? { password: PW } : { proof: b64u(pbkdf2Sync(Buffer.from(PW.normalize('NFC')), unb64u(salt.salt), salt.iters, 32, 'sha256')) }) } })).j.token
if (!tok) throw new Error('admin login failed')

/** نص الإدخال كما يبنيه المتصفح في src/services/rag/search.ts */
export const inputOf = (c) => `${c.lesson ?? c.chapter ?? ''}\n${c.text}`.trim().slice(0, 4000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync('public/library/vec', { recursive: true })
let total = 0
for (const item of manifest) {
  const out = `public/library/vec/${item.id}.bin`
  const { chunks } = JSON.parse(gunzipSync(unseal(readFileSync(`public/library/${item.idx}`))))
  const inputs = chunks.sort((a, b) => a.i - b.i).map(inputOf)
  const hashes = inputs.map((t) => createHash('sha256').update(t).digest().subarray(0, 8))
  if (existsSync(out)) {
    const buf = readFileSync(out)
    const n = buf.readUInt32BE(5)
    const head = JSON.parse(buf.subarray(9, 9 + n))
    const hs = buf.subarray(9 + n, 9 + n + head.n * 8)
    if (head.n === inputs.length && hashes.every((h, i) => h.equals(hs.subarray(i * 8, i * 8 + 8)))) {
      console.log('up to date', item.title)
      continue
    }
  }
  let model
  const vecs = []
  for (let i = 0; i < inputs.length; ) {
    // دفعة لا تتجاوز ٣٢ نصاً ولا حد حجم الطلب في الخادم
    let j = i, size = 0
    while (j < inputs.length && j - i < 32 && size + inputs[j].length < 48_000) size += inputs[j++].length
    const r = await call('/embed', { tok, body: { provider: 'auto', texts: inputs.slice(i, j) } })
    if (r.s === 429 || r.s === 503 || r.j.code === 'rate' || r.j.upstream === 429) {
      const wait = Math.min(120, Number(r.j.retryAfter) || 30)
      console.log('  busy, waiting', wait, 's')
      await sleep(wait * 1000)
      continue
    }
    if (r.s !== 200) throw new Error(`embed ${r.s} ${JSON.stringify(r.j).slice(0, 200)}`)
    if (model && r.j.model !== model) throw new Error('model changed mid-book')
    model = r.j.model
    vecs.push(...r.j.vectors)
    i = j
    await sleep(3000)
  }
  const dims = vecs[0].length
  const q = Buffer.alloc(vecs.length * dims)
  vecs.forEach((v, k) => {
    const norm = Math.hypot(...v) || 1
    for (let d = 0; d < dims; d++) q.writeInt8(Math.max(-127, Math.min(127, Math.round((v[d] / norm) * 127))), k * dims + d)
  })
  const head = Buffer.from(JSON.stringify({ model, dims, n: vecs.length }))
  const len = Buffer.alloc(4)
  len.writeUInt32BE(head.length)
  writeFileSync(out, Buffer.concat([Buffer.from('RVEC1'), len, head, ...hashes, q]))
  total += vecs.length
  console.log(item.title, vecs.length, 'chunks', Math.round((9 + head.length + vecs.length * (8 + dims)) / 1024), 'KB', model)
}
console.log('embedded', total)
