import { lazy, Suspense, useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { Toast } from './components/Toast'
import { Home } from './pages/Home'
import { usePath } from './router'
import { docsReady, resumePending } from './services/books/process'
import { toast } from './store/toast'
import { num } from './lib/format'
import { getState, useStore } from './store/store'
import { openPage, useViewer } from './store/viewer'

const Notebooks = lazy(() => import('./pages/Notebooks'))
const Workspace = lazy(() => import('./pages/Workspace'))
const Library = lazy(() => import('./pages/Library'))
const Review = lazy(() => import('./pages/Review'))
const Settings = lazy(() => import('./pages/Settings'))
const Progress = lazy(() => import('./pages/Progress'))
const PageViewer = lazy(() => import('./components/PageViewer'))

const TITLES: Record<string, string> = { '/notebooks': 'الدفاتر', '/library': 'المكتبة', '/review': 'المراجعة', '/progress': 'التقدم', '/settings': 'الإعدادات' }

function useDisplaySettings() {
  const { theme, textSize } = useStore((s) => s.data.settings)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.text = textSize
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1c1922' : '#faf6ee')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, textSize])
}

export function App() {
  useDisplaySettings()
  const path = usePath()
  const profileId = useStore((s) => s.activeId)
  const notebookId = path.match(/^\/notebooks\/(.+)$/)?.[1]
  const notebookTitle = useStore((s) => s.data.notebooks.find((n) => n.id === notebookId)?.title)

  const viewer = useViewer()

  // فهارس الدروس المحدّثة للكتب المنزّلة، دون إعادة تنزيلها
  useEffect(() => {
    void docsReady
      .then(() => import('./services/books/library'))
      .then((l) => l.syncLibrary())
      .then((n) => n && toast(`حُدّثت فهارس الدروس في ${num(n)} من كتبك.`))
      .catch(() => {})
  }, [profileId])

  // يكمل معالجة ما انقطع بإغلاق النافذة
  useEffect(() => {
    void resumePending(getState().data.books.map((b) => b.id), profileId)
  }, [profileId])

  const title = notebookTitle ?? TITLES[path]
  useEffect(() => {
    document.title = title ? `${title} | رفيق` : 'رفيق | مساعدك الدراسي'
  }, [title])
  useEffect(() => {
    // بين قوسين عمداً: scrollTo يعيد Promise في المتصفحات الحديثة
    window.scrollTo(0, 0)
  }, [path])
  useEffect(() => () => openPage(null), [path, profileId])

  const page = notebookId ? (
    <Workspace key={notebookId} id={notebookId} />
  ) : path === '/notebooks' ? (
    <Notebooks />
  ) : path === '/library' ? (
    <Library />
  ) : path === '/review' ? (
    <Review />
  ) : path === '/progress' ? (
    <Progress />
  ) : path === '/settings' ? (
    <Settings />
  ) : (
    <Home />
  )

  return (
    <>
      <AppShell path={path} compact={!!notebookId}>
        {/* المفتاح يعيد بناء الصفحة عند تبديل الطالب فلا تختلط حالة الطالبين */}
        <Suspense key={profileId} fallback={<div className="page-loading" role="status">جارٍ التحميل…</div>}>
          {page}
        </Suspense>
      </AppShell>
      {viewer && (
        <Suspense fallback={null}>
          <PageViewer key={`${viewer.bookId}:${viewer.page}`} target={viewer} />
        </Suspense>
      )}
      <Toast />
    </>
  )
}
