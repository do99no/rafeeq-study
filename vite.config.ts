import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// معرّف النسخة: رقم الإيداع في GitHub Actions، أو وقت البناء محلياً
declare const process: { env: Record<string, string | undefined> }
const BUILD = (process.env.GITHUB_SHA ?? '').slice(0, 7) || `local-${Date.now().toString(36)}`
const BUILT_AT = new Date().toISOString()

/** يكتب version.json بجانب الصفحة: التبويب المفتوح يقارن نسخته بها ليعرف أن نسخة أحدث نُشرت */
const version = (): Plugin => ({
  name: 'rafeeq-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, at: BUILT_AT }) })
  },
})

// مسار نسبي كي يعمل داخل أي مجلد على GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react(), version()],
  define: { __BUILD__: JSON.stringify(BUILD), __BUILT_AT__: JSON.stringify(BUILT_AT) },
})
