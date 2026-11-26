import { useState } from 'react'
import { NotebookPen, Plus, Search, SearchX, Star } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { NotebookCard } from '../components/NotebookCard'
import { NotebookForm } from '../components/NotebookForm'
import { normalize } from '../lib/format'
import { useData } from '../store/store'

export default function Notebooks() {
  const { notebooks } = useData()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('')
  const [favOnly, setFavOnly] = useState(false)

  const subjects = [...new Set(notebooks.map((n) => n.subject))]
  const activeSubject = subjects.includes(subject) ? subject : ''
  const q = normalize(query)
  const shown = notebooks
    .filter((n) => (!favOnly || n.favorite) && (!activeSubject || n.subject === activeSubject) && normalize(`${n.title} ${n.subject}`).includes(q))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastOpenedAt - a.lastOpenedAt)

  const newButton = (
    <button className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" /> دفتر جديد
    </button>
  )
  return (
    <div className="page">
      <header className="page-head">
        <h1>الدفاتر</h1>
        {notebooks.length > 0 && newButton}
      </header>
      {notebooks.length === 0 ? (
        <EmptyState icon={NotebookPen} title="لا توجد دفاتر بعد" text="أنشئ دفتراً لكل مادة أو باب، وأضف إليه كتبك في الخطوة نفسها.">
          {newButton}
        </EmptyState>
      ) : (
        <>
          <div className="filters">
            <label className="search">
              <Search aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في دفاترك" aria-label="ابحث في دفاترك" />
            </label>
            <div className="chips">
              <button className="chip" aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)}>
                <Star aria-hidden="true" /> المفضلة
              </button>
              {subjects.length > 1 &&
                subjects.map((s) => (
                  <button key={s} className="chip" aria-pressed={activeSubject === s} onClick={() => setSubject(activeSubject === s ? '' : s)}>
                    {s}
                  </button>
                ))}
            </div>
          </div>
          {shown.length ? (
            <div className="nb-grid">
              {shown.map((n) => (
                <NotebookCard key={n.id} nb={n} manage />
              ))}
            </div>
          ) : (
            <EmptyState icon={SearchX} title="لا نتائج مطابقة" text="غيّر كلمة البحث أو ألغِ التصفية لعرض كل الدفاتر." />
          )}
        </>
      )}
      {creating && <NotebookForm onClose={() => setCreating(false)} />}
    </div>
  )
}
