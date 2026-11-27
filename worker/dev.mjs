// تشغيل الخادم محلياً دون حساب Cloudflare. يقرأ worker/.dev.vars (غير مرفوع إلى Git).
// قاعدة البيانات محلية (node:sqlite) بدل D1: worker/.local/rafeeq.sqlite أو RAFEEQ_DB.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { localD1 } from './d1-local.mjs'
import worker from './index.mjs'

const file = new URL(process.env.RAFEEQ_VARS ?? '.dev.vars', import.meta.url)
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173' }
if (existsSync(file))
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
else console.log('لا يوجد ملف worker/.dev.vars. انسخ worker/.dev.vars.example واملأه.')
if (process.env.RAFEEQ_DB !== 'none') {
  const dbFile = process.env.RAFEEQ_DB ?? new URL('.local/rafeeq.sqlite', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
  mkdirSync(new URL('.local/', import.meta.url), { recursive: true })
  env.DB = localD1(dbFile)
}

const port = Number(process.env.PORT ?? 8787)
createServer(async (req, res) => {
  const ctrl = new AbortController()
  res.on('close', () => ctrl.abort())
  const chunks = []
  for await (const c of req) chunks.push(c)
  // محاكاة مهمة Cron للاختبار: POST /__scheduled من الجهاز نفسه فقط
  if (req.url === '/__scheduled' && req.method === 'POST') {
    const waits = []
    await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
    return res.end('ok')
  }
  const r = await worker.fetch(
    new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: ctrl.signal }),
    env,
  )
  res.writeHead(r.status, Object.fromEntries(r.headers))
  if (r.body) Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res)
  else res.end()
}).listen(port, '127.0.0.1', () => console.log(`Worker: http://localhost:${port}`))
