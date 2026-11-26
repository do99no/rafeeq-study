import { useState } from 'react'
import { ArrowLeft, BookOpenCheck, ChevronLeft, CircleHelp, GraduationCap, Layers, Library, NotebookPen, Plus, Target } from 'lucide-react'
import { isDue, normalCards } from '../components/outputs/CardsView'
import { NotebookCard } from '../components/NotebookCard'
import { NotebookForm } from '../components/NotebookForm'
import { LessonPicker } from '../components/workspace/LessonPicker'
import { ago, num } from '../lib/format'
import { startStudy } from '../lib/study'
import { Link } from '../router'
import { isSearchable, useDocs } from '../services/books/process'
import { useData, useStore } from '../store/store'
import type { Focus, Task } from '../types'

const START: { label: string; text: string; task: Task; icon: typeof Target; hint: string }[] = [
  { label: 'اشرح لي الدرس', text: 'اشرح لي هذا الدرس من البداية', task: 'explain', icon: BookOpenCheck, hint: 'شرح منظم كامل' },
  { label: 'علّمني خطوة بخطوة', text: 'علّمني هذا الدرس خطوة بخطوة', task: 'teach', icon: GraduationCap, hint: 'فكرة، مثال، سؤال' },
  { label: 'لخّصه لي', text: 'لخّص لي هذا الدرس', task: 'summary', icon: NotebookPen, hint: 'ملخص بعناوين ونقاط' },
  { label: 'اختبرني', text: 'اختبرني في هذا الدرس', task: 'check', icon: CircleHelp, hint: 'أسئلة وتصحيح' },
]

export function Home() {
  const data = useData()
  const { notebooks, books, studied, mistakes, outputs } = data
  const docs = useDocs()
  const name = useStore((s) => s.profiles.find((p) => p.id === s.activeId)?.name ?? '')
  const [creating, setCreating] = useState(false)
  const ready = books.filter((b) => isSearchable(docs[b.id]))
  const subjects = [...new Set(ready.map((b) => b.subject ?? b.title))]
  const [subject, setSubject] = useState('')
  const [picking, setPicking] = useState(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  const subjectBooks = ready.filter((b) => (b.subject ?? b.title) === subject)

  const last = Object.values(studied).sort((a, b) => b.at - a.at).slice(0, 3)
  const open = mistakes.filter((m) => !m.resolved)
  const weak = [...open.reduce((m, x) => m.set(x.topic, [...(m.get(x.topic) ?? []), x]), new Map<string, typeof open>())].sort((a, b) => b[1].length - a[1].length).slice(0, 3)
  const due = outputs.reduce((n, o) => n + (o.data.kind === 'cards' ? normalCards(o.data.cards, o.data.known).filter((c) => isDue(c)).length : 0), 0)
  const hour = new Date().getHours()

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            {hour < 12 ? 'صباح الخير' : 'مساء الخير'}، {name}
          </h1>
          <p className="muted">اختر درساً، وسيشرحه لك رفيق ويختبرك فيه من كتابك.</p>
        </div>
      </header>

      <section className="start panel" aria-labelledby="start-h">
        <h2 id="start-h">
          <Target aria-hidden="true" /> ابدأ الدراسة
        </h2>
        {ready.length === 0 ? (
          <div className="start-empty">
            <p className="muted">لا توجد كتب جاهزة على هذا الجهاز بعد. نزّل كتب المنهج من المكتبة برمز المكتبة.</p>
            <Link to="/library" className="btn btn-primary">
              <Library aria-hidden="true" /> افتح المكتبة
            </Link>
          </div>
        ) : (
          <>
            <div className="step">
              <span className="step-n">١</span>
              <div className="grow">
                <p className="step-t">المادة</p>
                <div className="chips">
                  {subjects.map((s) => (
                    <button
                      key={s}
                      className="chip"
                      aria-pressed={subject === s}
                      onClick={() => {
                        setSubject(s)
                        setFocus(null)
                        setPicking(true)
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="step" data-off={!subject}>
              <span className="step-n">٢</span>
              <div className="grow">
                <p className="step-t">الدرس</p>
                <button className="focus-btn" disabled={!subject} onClick={() => setPicking(true)}>
                  <span className="grow">
                    <strong>{focus ? focus.title : subject ? 'اختر الدرس' : 'اختر المادة أولاً'}</strong>
                    {focus && <small>{books.find((b) => b.id === focus.bookId)?.title}، ص {num(focus.from)}–{num(focus.to)}</small>}
                  </span>
                  <ChevronLeft aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="step" data-off={!focus}>
              <span className="step-n">٣</span>
              <div className="grow">
                <p className="step-t">كيف تريد أن تدرس؟</p>
                <div className="start-actions">
                  {START.map((a) => (
                    <button key={a.task} className="tool" disabled={!focus} onClick={() => focus && startStudy(focus.bookId, focus, { text: a.text, task: a.task })}>
                      <a.icon aria-hidden="true" />
                      <span>{a.label}</span>
                      <small className="muted">{a.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {(last.length > 0 || weak.length > 0 || due > 0) && (
        <div className="home-cols">
          {last.length > 0 && (
            <section className="recent" aria-labelledby="cont-h">
              <h2 id="cont-h">تابع من حيث توقفت</h2>
              <ul>
                {last.map((s) => (
                  <li key={s.key}>
                    <button className="recent-row" onClick={() => startStudy(s.bookId, { bookId: s.bookId, from: s.from, to: s.to, title: s.title })}>
                      <span className="grow">
                        <strong>{s.title}</strong>
                        <small className="muted">
                          {books.find((b) => b.id === s.bookId)?.title}
                          {s.taught ? `، الخطوة ${num(s.taught.k)} من ${num(s.taught.n)}` : s.explained ? '، شُرح' : ''}
                          {s.checks ? `، أسئلة ${num(s.checks.right)} من ${num(s.checks.total)}` : ''}، {ago(s.at)}
                        </small>
                      </span>
                      <ArrowLeft aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(weak.length > 0 || due > 0) && (
            <section className="recent" aria-labelledby="weak-h">
              <div className="section-head">
                <h2 id="weak-h">يحتاج إلى مراجعة</h2>
                <Link to="/progress" className="text-link">
                  التقدم
                </Link>
              </div>
              <ul>
                {weak.map(([topic, list]) => (
                  <li key={topic}>
                    <button
                      className="recent-row"
                      onClick={() => startStudy(list[0].bookId, undefined, { text: `راجع معي «${topic}»، فقد أخطأت في: ${list.slice(0, 3).map((m) => m.q).join('، ')}`, task: 'answer' })}
                    >
                      <span className="grow">
                        <strong>{topic}</strong>
                        <small className="muted">
                          {num(list.length)} {list.length > 2 ? 'أخطاء' : 'خطأ'}، {list[0].bookTitle}
                        </small>
                      </span>
                      <ArrowLeft aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {due > 0 && (
                  <li>
                    <Link to="/review" className="recent-row">
                      <Layers aria-hidden="true" />
                      <span className="grow">
                        <strong>{num(due)} بطاقة مستحقة للمراجعة اليوم</strong>
                      </span>
                      <ArrowLeft aria-hidden="true" />
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>
      )}

      {notebooks.length > 0 && (
        <section aria-labelledby="shelf-h">
          <div className="section-head">
            <h2 id="shelf-h">دفاتري</h2>
            <span className="btn-row">
              <button className="btn btn-sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> دفتر
              </button>
              <Link to="/notebooks" className="text-link">
                عرض الكل
              </Link>
            </span>
          </div>
          <div className="nb-grid">
            {[...notebooks]
              .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastOpenedAt - a.lastOpenedAt)
              .slice(0, 3)
              .map((n) => (
                <NotebookCard key={n.id} nb={n} />
              ))}
          </div>
        </section>
      )}
      {picking && subject && (
        <LessonPicker
          books={subjectBooks}
          value={focus ?? undefined}
          title={`دروس ${subject}`}
          onPick={(f) => setFocus(f)}
          onClose={() => setPicking(false)}
        />
      )}
      {creating && <NotebookForm onClose={() => setCreating(false)} />}
    </div>
  )
}
