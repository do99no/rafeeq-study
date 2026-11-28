import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { SubjectProgressList } from '../components/SubjectProgress'
import { ago, num } from '../lib/format'
import { computeProgress, nudges, type SubjectProgress } from '../lib/progress'
import { Link } from '../router'
import { lessonCatalog, savedCode } from '../services/books/library'
import type { Section } from '../services/books/types'
import { api, serverLibraryCode } from '../services/server/account'
import type { PackInfo } from '../services/study/lessonPack'
import { adminPlacementResults } from '../services/study/placement'
import { progressInput, SUBJECT_ORDER } from '../services/study/progressData'

const NAMES: Record<string, string> = { mohamed: 'محمد', amna: 'أمنة' }
type Cat = { id: string; title: string; subject: string; sections: Section[] }[]

/** تقدم طالب كما يراه المسؤول: من نسخة بياناته في الخادم، بالحساب نفسه الذي يراه الطالب */
async function loadStudent(id: string, cat: Cat, ready: Set<string>): Promise<{ progress: SubjectProgress[]; syncedAt?: number; examAt?: number }> {
  const r = await api<{ docs: { key: string; json: string; updated: number }[] }>(`/admin/data/${id}`)
  const core = r.docs.find((d) => d.key === 'core')
  const data = core ? JSON.parse(core.json) : {}
  const placement = await adminPlacementResults(id).then((x) => x.results).catch(() => [])
  const input = progressInput(cat, (b) => cat.find((c) => c.id === b)?.sections, { studied: data.studied ?? {}, attempts: data.attempts ?? [], outputs: data.outputs ?? [], mistakes: data.mistakes ?? [] }, placement, ready, id)
  const plan = await api<{ plan?: { examDate?: string } }>(`/admin/student/${id}`).then((x) => x.plan).catch(() => undefined)
  const exam = plan?.examDate || data.settings?.examDate
  return { progress: computeProgress(input), syncedAt: core?.updated, examAt: exam ? Date.parse(exam + 'T00:00:00') : undefined }
}
let catCache: Promise<{ cat: Cat; ready: Set<string> }> | undefined
const loadShared = () =>
  (catCache ??= (async () => {
    const code = (await serverLibraryCode().catch(() => null)) || savedCode()
    if (!code) throw new Error('code')
    const [cat, idx] = await Promise.all([lessonCatalog(code), api<{ lessons: PackInfo[] }>('/lessons')])
    return { cat: cat as Cat, ready: new Set(idx.lessons.filter((l) => l.status !== 'hidden').map((l) => `${l.bookId}:${l.sectionId}`)) }
  })())

const overall = (p: SubjectProgress[]) => {
  const t = p.reduce((n, x) => n + x.total, 0)
  return t ? Math.round(p.reduce((n, x) => n + (x.coverage * x.total) / 100, 0) / t * 100) : 0
}

/** لوحة المسؤول: الطالبان معاً (مقارنة إدارية للمتابعة فقط، لا تظهر لأي طالب)، ثم تفاصيل كل طالب */
export function AdminProgress() {
  const [state, setState] = useState<Record<string, { progress: SubjectProgress[]; syncedAt?: number; examAt?: number }> | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('mohamed')
  useEffect(() => {
    void (async () => {
      try {
        const { cat, ready } = await loadShared()
        const out: Record<string, { progress: SubjectProgress[]; syncedAt?: number; examAt?: number }> = {}
        for (const id of ['mohamed', 'amna']) out[id] = await loadStudent(id, cat, ready).catch(() => ({ progress: [] }))
        setState(out)
      } catch {
        setError('تعذّر تحميل فهارس الدروس أو بيانات الطالبين.')
      }
    })()
  }, [])
  if (error) return <div className="page"><p className="warn">{error}</p></div>
  if (!state) return <div className="page"><p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> جارٍ التحميل…</p></div>
  const subjects = SUBJECT_ORDER.filter((s) => Object.values(state).some((x) => x.progress.some((p) => p.subject === s)))
  const cell = (id: string, s: string) => {
    const p = state[id]?.progress.find((x) => x.subject === s)
    if (!p) return <td className="muted">—</td>
    return <td>{p.done || p.started ? `${num(p.coverage)}٪` : 'لم يبدأ'}<small className="muted">{p.mastery !== null ? ` · إتقان ${num(p.mastery)}٪` : ''}</small></td>
  }
  const cur = state[tab]
  const alerts = cur ? nudges(cur.progress, { num, examAt: cur.examAt }).filter((n) => n.kind !== 'praise') : []
  return (
    <div className="page">
      <Link to="/admin" className="text-link back-link">لوحة المتابعة</Link>
      <header className="page-head">
        <div>
          <h1>تقدم الطالبين</h1>
          <p className="muted">النسبة: تغطية المنهج. الإتقان: صحة الإجابات (بعد ٥ إجابات). من آخر مزامنة لبيانات كل طالب.</p>
        </div>
      </header>
      <section className="panel">
        <h2>مقارنة إدارية</h2>
        <div className="table-wrap">
          <table className="sp-table">
            <thead>
              <tr><th>المادة</th><th>محمد</th><th>أمنة</th></tr>
            </thead>
            <tbody>
              <tr><th>الإجمالي</th><td><strong>{num(overall(state.mohamed?.progress ?? []))}٪</strong></td><td><strong>{num(overall(state.amna?.progress ?? []))}٪</strong></td></tr>
              {subjects.map((s) => <tr key={s}><th>{s}</th>{cell('mohamed', s)}{cell('amna', s)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <nav className="tabs" aria-label="الطالب">
        {['mohamed', 'amna'].map((id) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{NAMES[id]}</button>
        ))}
      </nav>
      {cur && (
        <section className="panel">
          <h2>{NAMES[tab]}: {num(overall(cur.progress))}٪ من المنهج</h2>
          <p className="muted">{cur.syncedAt ? `آخر مزامنة ${ago(cur.syncedAt)}` : 'لا بيانات مزامنة بعد'}{(() => { const l = Math.max(0, ...cur.progress.map((p) => p.lastAt ?? 0)); return l ? ` · آخر نشاط دراسي ${ago(l)}` : '' })()}</p>
          {alerts.length > 0 && (
            <>
              <h3 className="mini-h">يحتاج إلى متابعة</h3>
              <ul className="nudges">{alerts.slice(0, 6).map((n, i) => <li key={i} data-kind={n.kind}><span className="grow">{n.text}</span></li>)}</ul>
            </>
          )}
          <h3 className="mini-h">المواد</h3>
          <SubjectProgressList items={cur.progress} />
        </section>
      )}
    </div>
  )
}
