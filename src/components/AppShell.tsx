import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, ChartNoAxesColumn, FileCheck, Cloud, CloudOff, GraduationCap, House, Library, LogOut, Menu, NotebookTabs, RefreshCw, Settings, Timer, Users } from 'lucide-react'
import { useAccount } from '../services/server/account'
import { signOut } from '../services/server/session'
import { useSync } from '../services/server/sync'
import { useTracker } from '../services/server/tracker'
import { Link } from '../router'
import { actions, useStore } from '../store/store'
import { Dialog } from './Dialog'

const NAV = [
  { to: '/', label: 'الرئيسية', icon: House },
  { to: '/notebooks', label: 'الدفاتر', icon: NotebookTabs },
  { to: '/library', label: 'المكتبة', icon: Library },
  { to: '/review', label: 'المراجعة', icon: GraduationCap },
  { to: '/exams', label: 'الامتحانات', icon: FileCheck },
  { to: '/progress', label: 'التقدم', icon: ChartNoAxesColumn },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
]

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="رفيق، الصفحة الرئيسية">
      <span className="brand-mark" aria-hidden="true">
        <BookOpen />
      </span>
      <span className="brand-text">
        <strong>رفيق</strong>
        <small>مساعدك الدراسي</small>
      </span>
    </Link>
  )
}

const TRACK_TEXT = { active: 'يُحتسب وقت الدراسة', idle: 'متوقف: لا تفاعل', hidden: 'متوقف: الصفحة مخفية', offline: 'متوقف: لا اتصال' } as const

/** شارة ظاهرة دائماً على الهاتف: هل يُحتسب وقت الدراسة الآن */
function TrackChip() {
  const track = useTracker()
  const student = useAccount().session?.user.role === 'student'
  if (!student || track === 'off') return null
  return (
    <span className="track-chip" data-track={track} role="status" title={`${TRACK_TEXT[track]}. يُسجَّل وقت دراستك الفعلي فقط.`}>
      <Timer aria-hidden="true" /> {track === 'active' ? 'يُحتسب' : 'متوقف'}
      <span className="sr-only">{TRACK_TEXT[track]}</span>
    </span>
  )
}

/** الطالب الداخل بحسابه: اسمه، وحالة الحفظ على الخادم، وهل يُحتسب وقت الدراسة الآن */
function AccountBox() {
  const session = useAccount().session
  const sync = useSync()
  const track = useTracker()
  if (!session || session.user.role !== 'student') return null
  return (
    <div className="account-box">
      <strong>{session.user.name}</strong>
      <span className="account-state" title="حالة حفظ بياناتك على الخادم">
        {sync === 'offline' ? <CloudOff aria-hidden="true" /> : sync === 'saving' ? <RefreshCw aria-hidden="true" /> : <Cloud aria-hidden="true" />}
        {sync === 'offline' ? 'دون اتصال: محفوظ على الجهاز' : sync === 'saving' ? 'يحفظ…' : sync === 'error' ? 'تعذّر الحفظ، سيُعاد' : 'محفوظ'}
      </span>
      {track !== 'off' && (
        <span className="account-state" data-track={track} title="يُحتسب وقت الدراسة الفعلي فقط">
          <Timer aria-hidden="true" />
          {TRACK_TEXT[track]}
        </span>
      )}
      <button className="btn btn-sm" onClick={() => void signOut()}>
        <LogOut aria-hidden="true" /> خروج
      </button>
    </div>
  )
}

function NavContent({ path }: { path: string }) {
  const profiles = useStore((s) => s.profiles)
  const activeId = useStore((s) => s.activeId)
  const account = !!useAccount().session
  return (
    <>
      <nav className="nav" aria-label="القائمة الرئيسية">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = to === '/' ? path === '/' : path.startsWith(to)
          return (
            <Link key={to} to={to} className="nav-link" aria-current={active ? 'page' : undefined} title={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
      <AccountBox />
      {!account && <label className="profile-switch" title="تبديل الطالب">
        <Users aria-hidden="true" />
        <select value={activeId} onChange={(e) => actions.switchProfile(e.target.value)} aria-label="الطالب الحالي">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>}
    </>
  )
}

export function AppShell({ path, compact, children }: { path: string; compact: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  return (
    <div className={compact ? 'shell shell-compact' : 'shell'}>
      <aside className="sidebar">
        <Brand />
        <NavContent path={path} />
      </aside>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="فتح القائمة">
          <Menu />
        </button>
        <Brand />
        <TrackChip />
      </header>
      {open && (
        <Dialog variant="start" title="رفيق" onClose={() => setOpen(false)}>
          <div className="drawer-nav">
            <NavContent path={path} />
          </div>
        </Dialog>
      )}
      <main className="main">{children}</main>
    </div>
  )
}
