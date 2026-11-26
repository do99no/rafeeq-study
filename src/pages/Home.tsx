import { useState } from 'react'
import { ArrowLeft, ChevronLeft, NotebookPen, Plus } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { NotebookCard } from '../components/NotebookCard'
import { NotebookForm } from '../components/NotebookForm'
import { ago } from '../lib/format'
import { Link } from '../router'
import { useData, useStore } from '../store/store'

export function Home() {
  const { notebooks, messages } = useData()
  const name = useStore((s) => s.profiles.find((p) => p.id === s.activeId)?.name ?? '')
  const [creating, setCreating] = useState(false)

  const recent = [...notebooks].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const session = recent.find((n) => messages[n.id]?.length)
  const lastQuestion = session && messages[session.id].findLast((m) => m.role === 'user')?.text
  const shelf = [...notebooks].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastOpenedAt - a.lastOpenedAt).slice(0, 6)
  const hour = new Date().getHours()

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            {hour < 12 ? 'صباح الخير' : 'مساء الخير'}، {name}
          </h1>
          <p className="muted">ماذا نذاكر اليوم؟</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" /> دفتر جديد
        </button>
      </header>

      {notebooks.length === 0 ? (
        <EmptyState icon={NotebookPen} title="ابدأ دفترك الأول" text="اجمع كتب مادة واحدة في دفتر، ثم اسأل رفيق عما فيها.">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> إنشاء دفتر
          </button>
        </EmptyState>
      ) : (
        <>
          <div className={session ? 'home-top' : 'home-top no-session'}>
            {session && (
              <section className="resume" aria-label="آخر جلسة دراسة">
                <p className="resume-label">آخر جلسة دراسة، {ago(session.lastOpenedAt)}</p>
                <h2>{session.title}</h2>
                {lastQuestion && <p className="resume-q">«{lastQuestion}»</p>}
                <Link to={`/notebooks/${session.id}`} className="btn btn-light">
                  تابع الدراسة <ArrowLeft aria-hidden="true" />
                </Link>
              </section>
            )}
            <section className="recent" aria-labelledby="recent-h">
              <h2 id="recent-h">آخر الدفاتر المستخدمة</h2>
              <ul>
                {recent.slice(0, 3).map((n) => (
                  <li key={n.id}>
                    <Link to={`/notebooks/${n.id}`} className="recent-row" data-hue={n.hue}>
                      <span className="spine" aria-hidden="true" />
                      <span className="grow">
                        <strong>{n.title}</strong>
                        <small className="muted">
                          {n.subject}، {ago(n.lastOpenedAt)}
                        </small>
                      </span>
                      <ChevronLeft aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="shelf-h">
            <div className="section-head">
              <h2 id="shelf-h">دفاتري الدراسية</h2>
              <Link to="/notebooks" className="text-link">
                عرض الكل
              </Link>
            </div>
            <div className="nb-grid">
              {shelf.map((n) => (
                <NotebookCard key={n.id} nb={n} />
              ))}
            </div>
          </section>
        </>
      )}
      {creating && <NotebookForm onClose={() => setCreating(false)} />}
    </div>
  )
}
