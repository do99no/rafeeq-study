import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css'
import '@fontsource/ibm-plex-sans-arabic/latin-400.css'
import '@fontsource/ibm-plex-sans-arabic/latin-600.css'
import './styles/base.css'
import './styles/app.css'
import './styles/workspace.css'
import './styles/study.css'
import './styles/account.css'
import './styles/placement.css'
import './styles/design.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// العمل دون اتصال: في النسخة المنشورة فقط
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active?.postMessage({ cache: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.startsWith(location.origin)) }))
      .catch(() => {})
  })
