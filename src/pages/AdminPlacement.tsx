import { useEffect, useState } from 'react'
import { CircleCheck, Download, LoaderCircle, RotateCcw, Send, TriangleAlert } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import { ago, num } from '../lib/format'
import { Link } from '../router'
import { lessonCatalog, openLibrary } from '../services/books/library'
import type { Section } from '../services/books/types'
import { api, serverLibraryCode } from '../services/server/account'
import type { LessonPack, PackInfo } from '../services/study/lessonPack'
import { adminPlacement, adminPlacementReset, adminPlacementResults, buildBank, publishBank, type AdminPlacement as AP, type BankBook, type BankBuild, type SubjectResult } from '../services/study/placement'
import { lessonsOf } from '../services/study/prepare'
import { toast } from '../store/toast'

const ORDER = ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء', 'العلوم الهندسية', 'اللغة العربية', 'اللغة الإنجليزية', 'التربية الإسلامية']
const NAMES: Record<string, string> = { mohamed: 'محمد', amna: 'أمنة', qa_bio: 'تجربة: مسار الأحياء', qa_eng: 'تجربة: مسار العلوم الهندسية' }

/** بنك تحديد المستوى ونتائج الطلاب: البناء من الدروس الجاهزة، والنشر، والاطلاع، وإعادة التعيين المحمية */
export function AdminPlacement() {
  const [builds, setBuilds] = useState<BankBuild[] | null>(null)
  const [state, setState] = useState<AP | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [view, setView] = useState<{ id: string; results: SubjectResult[] } | null>(null)
  const [reset, setReset] = useState<string | null>(null)

  const reload = () => adminPlacement().then(setState).catch(() => setError('تعذّر الاتصال بالخادم.'))
  useEffect(() => {
    void (async () => {
      try {
        await reload()
        const code = await serverLibraryCode()
        if (!code) return setError('رمز المكتبة غير مُعدّ في الخادم.')
        const [items, cat, idx] = await Promise.all([openLibrary(code), lessonCatalog(code), api<{ lessons: PackInfo[] }>('/lessons')])
        const books: BankBook[] = items.map((i) => ({ id: i.id, title: i.title, subject: i.subject, sections: (cat.find((c) => c.id === i.id)?.sections ?? []) as Section[] })).sort((a, b) => a.title.localeCompare(b.title, 'ar'))
        const info = (b: string, s: string) => idx.lessons.find((r) => r.bookId === b && r.sectionId === s)
        const packs: Record<string, Record<string, LessonPack>> = {}
        for (const b of books)
          if (idx.lessons.some((l) => l.bookId === b.id)) packs[b.id] = Object.fromEntries((await api<{ lessons: LessonPack[] }>(`/lessons/${encodeURIComponent(b.id)}`)).lessons.map((p) => [p.sectionId, p]))
        const out = ORDER.map((s) => buildBank(s, books.filter((b) => b.subject === s), info, (id) => packs[id] ?? {}, lessonsOf))
        setBuilds(out)
        // لأداة المراجعة: المرشحون مع مقاطعهم
        ;(window as unknown as { rafeeqBank?: BankBuild[] }).rafeeqBank = out
      } catch {
        setError('تعذّر فتح المكتبة أو حزم الدروس.')
      }
    })()
  }, [])

  const exportCandidates = (b: BankBuild) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(b.candidates, null, 1)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `placement-${b.subject}.json` })
    a.click()
    URL.revokeObjectURL(url)
  }
  const publish = async (b: BankBuild, on: boolean) => {
    setBusy(b.subject)
    try {
      await publishBank(b, on)
      toast(on ? `نُشر بنك ${b.subject} (${num(b.items.length)} سؤالاً).` : `حُفظ بنك ${b.subject} دون نشر.`)
      await reload()
    } catch {
      toast('تعذّر الحفظ.')
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className="page"><p className="warn">{error}</p></div>
  return (
    <div className="page">
      <Link to="/admin" className="text-link back-link">لوحة المتابعة</Link>
      <header className="page-head">
        <div>
          <h1>تحديد المستوى</h1>
          <p className="muted">اختبار لكل مادة من أسئلة الدروس الجاهزة، بعد فحص آلي (المقطع، والإجابة في الكتاب، ولا خطأ موثق في الصفحة) ومراجعة كل سؤال يدوياً. الإجابات لا تصل إلى الطالب قبل تسليم اختبارات كل مواده.</p>
        </div>
      </header>

      <section className="panel">
        <h2>الطلاب</h2>
        {!state ? <p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> جارٍ التحميل…</p> : (
          <ul className="admin-list">
            {state.people.map((p) => (
              <li key={p.id}>
                <span className="grow">
                  <strong>{NAMES[p.id] ?? p.id}</strong>
                  <small className="muted">
                    {p.journey ? (p.journey.completed ? `أكمل الرحلة ${ago(p.journey.completed)}` : `بدأ ${ago(p.journey.started)}، سلّم ${num(p.tests.filter((t) => t.status === 'submitted').length)} من ${num(p.journey.subjects.length)}`) : 'لم تبدأ رحلته (تبدأ حين تُنشر بنوك كل مواده)'}
                    {p.tests.filter((t) => t.status === 'submitted').map((t) => ` · ${t.subject} ${num(t.score ?? 0)}/${num(t.total ?? 0)}`).join('')}
                  </small>
                </span>
                {p.tests.some((t) => t.status === 'submitted') && <button className="btn btn-sm" onClick={() => void adminPlacementResults(p.id).then((r) => setView({ id: p.id, results: r.results }))}>النتائج</button>}
                {p.journey && <button className="icon-btn" title="إعادة تعيين" aria-label={`إعادة تعيين ${NAMES[p.id]}`} onClick={() => setReset(p.id)}><RotateCcw /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>بنوك الأسئلة</h2>
        {!builds ? <p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> يبني البنوك من الدروس الجاهزة…</p> : (
          <ul className="admin-list bank-list">
            {builds.map((b) => {
              const live = state?.banks.find((x) => x.subject === b.subject)
              return (
                <li key={b.subject} data-subject={b.subject}>
                  <span className="grow">
                    <strong>{b.subject}</strong>
                    <small className="muted">
                      {num(b.items.length)} سؤالاً معتمداً، {num(b.minutes)} دقيقة، الدروس الجاهزة {num(b.coverage.readyLessons)} من {num(b.coverage.totalLessons)}، يغطي {num(b.coverage.covered)} من {num(b.coverage.units)} وحدة
                      {b.unreviewed ? `، ${num(b.unreviewed)} مرشحاً بانتظار المراجعة` : ''}
                      {live?.published ? `، منشور (${num(live.n)} سؤالاً، ${ago(live.updated ?? 0)})` : '، غير منشور'}
                    </small>
                    {b.blockers.length > 0 && <small className="warn-line"><TriangleAlert aria-hidden="true" /> {b.blockers.join('؛ ')}</small>}
                  </span>
                  <button className="icon-btn" title="تصدير المرشحين للمراجعة" aria-label={`تصدير مرشحي ${b.subject}`} disabled={!b.candidates.length} onClick={() => exportCandidates(b)}><Download /></button>
                  {live?.published ? (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => void publish(b, false)}>إيقاف النشر</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" disabled={!!busy || b.blockers.length > 0 || b.unreviewed > 0} onClick={() => void publish(b, true)}>
                      {busy === b.subject ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />} انشر
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {view && (
        <Dialog title={`نتائج ${NAMES[view.id]}`} onClose={() => setView(null)}>
          {view.results.map((r) => (
            <section key={r.subject}>
              <h3>{r.subject}: {num(r.correct)} من {num(r.total)} ({num(r.percent)}٪)</h3>
              <ol className="admin-answers">
                {r.items.map((x) => (
                  <li key={x.id} data-ok={x.ok}>{x.ok ? <CircleCheck aria-label="صحيحة" /> : <TriangleAlert aria-label="خاطئة" />} {x.q} <small className="muted">— {x.given === null ? 'لم يُجب' : x.options[x.given]}{x.ok ? '' : ` (الصحيح: ${x.options[x.correct]})`}</small></li>
                ))}
              </ol>
            </section>
          ))}
        </Dialog>
      )}
      {reset && <ResetDialog id={reset} onClose={() => setReset(null)} onDone={() => void reload()} />}
    </div>
  )
}

/** إعادة التعيين: يكتب المسؤول عبارة التأكيد بنفسه، وتُحفظ المحاولة السابقة في الأرشيف */
function ResetDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const phrase = `إعادة ${id}`
  return (
    <Dialog title={`إعادة تعيين تحديد المستوى: ${NAMES[id]}`} onClose={onClose}>
      <p>يعود الاختبار إلى بدايته لهذا الحساب. المحاولة السابقة ونتائجها تُحفظ في الأرشيف ولا تُحذف. للتأكيد اكتب: <bdi><strong>{phrase}</strong></bdi></p>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="عبارة التأكيد" />
      <div className="btn-row">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn btn-danger" disabled={text.trim() !== phrase} onClick={() => void adminPlacementReset(id).then(() => (toast('أُعيد التعيين.'), onDone(), onClose())).catch(() => toast('تعذّر.'))}>أعد التعيين</button>
      </div>
    </Dialog>
  )
}
