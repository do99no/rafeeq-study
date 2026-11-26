import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, GraduationCap, House, Library, Menu, NotebookTabs, Settings, Users } from 'lucide-react'
import { Link } from '../router'
import { actions, useStore } from '../store/store'
import { Dialog } from './Dialog'

const NAV = [
  { to: '/', label: 'الرئيسية', icon: House },
  { to: '/notebooks', label: 'الدفاتر', icon: NotebookTabs },
  { to: '/library', label: 'المكتبة', icon: Library },
  { to: '/review', label: 'المراجعة', icon: GraduationCap },
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

function NavContent({ path }: { path: string }) {
  const profiles = useStore((s) => s.profiles)
  const activeId = useStore((s) => s.activeId)
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
      <label className="profile-switch" title="تبديل الطالب">
        <Users aria-hidden="true" />
        <select value={activeId} onChange={(e) => actions.switchProfile(e.target.value)} aria-label="الطالب الحالي">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
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
