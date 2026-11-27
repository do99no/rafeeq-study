import { useSyncExternalStore } from 'react'

declare const __BUILD__: string
declare const __BUILT_AT__: string

/**
 * التبويب المفتوح لا يجلب الصفحة من جديد بعد النشر، فيبقى على النسخة القديمة أياماً، وتفشل أجزاؤه
 * المؤجلة لأن ملفاتها القديمة حُذفت. هنا: مقارنة النسخة بـ version.json عند العودة إلى التبويب وكل
 * عشر دقائق، وإعادة التحميل تلقائياً إن تعذّر تحميل جزء من نسخة قديمة.
 */
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'
export const BUILT_AT = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : ''

let latest: string | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((l) => l())

async function check() {
  if (BUILD === 'dev' || document.visibilityState === 'hidden') return
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = (await r.json()) as { build?: string }
    if (v.build && v.build !== BUILD && v.build !== latest) {
      latest = v.build
      emit()
    }
  } catch {
    // بلا اتصال: لا شيء
  }
}

let started = false
export function watchVersion() {
  if (started) return
  started = true
  void check()
  setInterval(check, 10 * 60_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check())
  // جزء من نسخة قديمة لم يعد موجوداً: إعادة تحميل الصفحة مرة واحدة (لا حلقة إن تكرر الفشل)
  window.addEventListener('vite:preloadError', (e) => {
    const key = 'rafeeq-reloaded-for'
    try {
      if (sessionStorage.getItem(key) === BUILD) return
      sessionStorage.setItem(key, BUILD)
    } catch {
      return
    }
    e.preventDefault()
    location.reload()
  })
}

export const useNewVersion = () => useSyncExternalStore((l) => (subs.add(l), () => void subs.delete(l)), () => latest)
