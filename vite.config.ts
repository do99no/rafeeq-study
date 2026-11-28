import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// معرّف النسخة: رقم الإيداع في GitHub Actions، أو وقت البناء محلياً
declare const process: { env: Record<string, string | undefined> }
const BUILD = (process.env.GITHUB_SHA ?? '').slice(0, 7) || `local-${Date.now().toString(36)}`
const BUILT_AT = new Date().toISOString()

/**
 * عامل خدمة صغير مكتوب يدوياً (بلا مكتبات):
 * - الملفات ذات البصمة (assets/) من الذاكرة أولاً: لا تتغير أبداً.
 * - الصفحة من الشبكة أولاً، وعند الانقطاع من آخر نسخة محفوظة.
 * - لا تنزيل مسبق لكل الملفات: كل ملف يُحفظ عند أول استعمال، فلا يستهلك تحديث النسخة الإنترنت.
 * - ملفات المكتبة والخادم لا يتدخل فيها (المكتبة محفوظة في IndexedDB، وطلبات الخادم يديرها التطبيق).
 */
const SW = `const C = 'rafeeq-__BUILD__'
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.add(new URL('./', self.registration.scope))).catch(() => {}).then(() => self.skipWaiting())))
// الصفحة ترسل ما حمّلته قبل أن يتولى العامل (من ذاكرة المتصفح، فلا تنزيل جديد)
self.addEventListener('message', (e) => { const urls = e.data?.cache; if (Array.isArray(urls)) e.waitUntil(caches.open(C).then((c) => Promise.all(urls.filter((x) => typeof x === 'string' && x.includes('/assets/')).map((x) => c.match(x).then((hit) => hit || c.add(x)).catch(() => {}))))) })
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // النسخ الأقدم تُحذف؛ والتبويب القديم الذي يفقد ملفاً يعيد التحميل (src/lib/version.ts)
  const keys = (await caches.keys()).filter((k) => k.startsWith('rafeeq-') && k !== C)
  await Promise.all(keys.map((k) => caches.delete(k)))
  await self.clients.claim()
})()))
self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.method !== 'GET') return
  const u = new URL(r.url)
  if (u.origin !== location.origin || u.pathname.includes('/library/') || u.pathname.endsWith('version.json')) return
  if (u.pathname.includes('/assets/')) {
    e.respondWith(caches.open(C).then(async (c) => (await c.match(r)) || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res })))
    return
  }
  if (r.mode === 'navigate' || ['.html', '.svg', '.webmanifest', '.txt'].some((x) => u.pathname.endsWith(x)) || u.pathname.endsWith('/')) {
    e.respondWith(fetch(r).then((res) => { if (res.ok) caches.open(C).then((c) => c.put(r.mode === 'navigate' ? new Request(new URL('./', self.registration.scope)) : r, res.clone())); return res })
      .catch(async () => (await caches.match(r.mode === 'navigate' ? new URL('./', self.registration.scope).href : r)) || Response.error()))
  }
})
`

/** يكتب version.json بجانب الصفحة: التبويب المفتوح يقارن نسخته بها ليعرف أن نسخة أحدث نُشرت */
const version = (): Plugin => ({
  name: 'rafeeq-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, at: BUILT_AT }) })
    // عامل الخدمة: يفتح التطبيق دون اتصال. يتغير نصه مع كل نسخة فيتحدث المتصفح
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: SW.replace('__BUILD__', BUILD) })
  },
})

// مسار نسبي كي يعمل داخل أي مجلد على GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react(), version()],
  define: { __BUILD__: JSON.stringify(BUILD), __BUILT_AT__: JSON.stringify(BUILT_AT) },
})
