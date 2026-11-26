// تشغيل الوسيط محلياً دون حساب Cloudflare. يقرأ worker/.dev.vars (غير مرفوع إلى Git).
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import worker from './index.mjs'

const file = new URL(process.env.RAFEEQ_VARS ?? '.dev.vars', import.meta.url)
const env = { ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173' }
if (existsSync(file))
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
else console.log('لا يوجد ملف worker/.dev.vars. انسخ worker/.dev.vars.example واملأه.')

const port = Number(process.env.PORT ?? 8787)
createServer(async (req, res) => {
  const ctrl = new AbortController()
  res.on('close', () => ctrl.abort())
  const chunks = []
  for await (const c of req) chunks.push(c)
  const r = await worker.fetch(
    new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: ctrl.signal }),
    env,
  )
  res.writeHead(r.status, Object.fromEntries(r.headers))
  if (r.body) Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res)
  else res.end()
}).listen(port, '127.0.0.1', () => console.log(`Worker: http://localhost:${port}`))
