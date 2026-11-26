// يعيد ربط سجل التشفير المحلي بملفات PDF المشفرة المنشورة فعلاً (من manifest.bin الحالي)،
// كي لا تُعاد كتابة ملفات الكتب الكبيرة عند تغيّر الفهرس فقط.
// node scripts/relink-packs.mjs
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const W = 'books-work'
const code = readFileSync(`${W}/library-code.txt`, 'utf8').trim()
const info = JSON.parse(readFileSync('public/library/info.json', 'utf8'))
const key = pbkdf2Sync(code, Buffer.from(info.salt, 'base64'), info.rounds, 32, 'sha256')
const buf = readFileSync('public/library/manifest.bin')
const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
d.setAuthTag(buf.subarray(buf.length - 16))
const manifest = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString())
const cacheFile = `${W}/sealed.json`
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
for (const m of manifest) {
  if (!existsSync(`public/library/${m.file}`)) continue
  cache[m.id] = { ...cache[m.id], file: m.file, size: m.size }
  console.log(m.title, '→', m.file)
}
delete cache.manifest
writeFileSync(cacheFile, JSON.stringify(cache))
