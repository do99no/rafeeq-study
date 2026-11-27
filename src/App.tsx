import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Toast } from './components/Toast'
import { Home } from './pages/Home'
import { usePath } from './router'
import { docsReady, resumePending } from './services/books/process'
import { toast } from './store/toast'
import { num } from './lib/format'
import { getState, useStore } from './store/store'
import { openPage, useViewer } from './store/viewer'
import { initAccounts, useAccount } from './services/server/account'
import { beginStudent } from './services/server/session'
import { logEvent, setStudying, setTask } from './services/server/tracker'
import { Login, Setup } from './pages/Login'
import { ImportLocal } from './components/ImportLocal'

const Notebooks = lazy(() => import('./pages/Notebooks'))
const Workspace = lazy(() => import('./pages/Workspace'))
const Library = lazy(() => import('./pages/Library'))
const Review = lazy(() => import('./pages/Review'))
const Settings = lazy(() => import('./pages/Settings'))
const Progress = lazy(() => import('./pages/Progress'))
const Exams = lazy(() => import('./pages/Exams'))
const PageViewer = lazy(() => import('./components/PageViewer'))
const AdminApp = lazy(() => import('./pages/Admin'))

const TITLES: Record<string, string> = { '/notebooks': 'المواد والدفاتر', '/library': 'الكتب', '/review': 'المراجعة', '/progress': 'التقدم', '/exams': 'الامتحانات والتدريب', '/settings': 'الإعدادات' }

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

function StudentApp() {
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

  // وقت الدراسة: داخل دفتر أو القارئ أو المراجعة فقط
  const student = useAccount().session?.user.role === 'student'
  const focus = useStore((s) => s.data.notebooks.find((n) => n.id === notebookId)?.focus)
  const books = useStore((s) => s.data.books)
  useEffect(() => {
    if (!student) return
    const book = books.find((b) => b.id === (viewer?.bookId ?? focus?.bookId))
    setStudying(!!notebookId || !!viewer || path === '/review' || path === '/exams', book ? { subject: book.subject, bookId: book.id, book: book.title, lesson: viewer ? undefined : focus?.title } : undefined)
  }, [student, notebookId, viewer, path, focus, books])
  useEffect(() => {
    if (!student || !viewer) return
    setTask('read')
    logEvent('read_page', `ص ${viewer.page}`, { bookId: viewer.bookId, book: books.find((b) => b.id === viewer.bookId)?.title })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, viewer?.bookId, viewer?.page])
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
  ) : path === '/exams' ? (
    <Exams />
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

/** البوابة: الوضع المحلي كما كان، أو الحسابات (دخول، مسؤول، طالب) */
export function App() {
  const acct = useAccount()
  const path = usePath()
  const [needImport, setNeedImport] = useState(false)
  useEffect(() => {
    void initAccounts()
  }, [])
  const user = acct.session?.user
  useEffect(() => {
    if (user?.role !== 'student') return
    void beginStudent(user).then((r) => setNeedImport(r.empty))
  }, [user?.id, user?.role])
  if (acct.mode === 'checking' && !acct.session) return <div className="page-loading" role="status">جارٍ التحميل…</div>
  if (acct.mode === 'accounts' && !user)
    return (
      <>
        {acct.status?.setup ? <Setup onDone={() => {}} /> : <Login status={acct.status ?? { accounts: true }} onDone={() => {}} />}
        <Toast />
      </>
    )
  if (user?.role === 'admin')
    return (
      <>
        <Suspense fallback={<div className="page-loading">جارٍ التحميل…</div>}>
          <AdminApp path={path} />
        </Suspense>
        <Toast />
      </>
    )
  return (
    <>
      <StudentApp />
      {needImport && <ImportLocal onClose={() => setNeedImport(false)} />}
    </>
  )
}
