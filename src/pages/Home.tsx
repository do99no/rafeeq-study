import { ArrowLeft, Layers } from 'lucide-react'
import { isDue, normalCards } from '../components/outputs/CardsView'
import { ago, booksCount, lessonsCount, num } from '../lib/format'
import { setupCurriculum, useCurriculum } from '../services/books/curriculum'
import { packOf, usePacks } from '../services/study/lessonPack'
import { startStudy } from '../lib/study'
import { Link } from '../router'
import { isSearchable, useDocs } from '../services/books/process'
import { useData, useStore } from '../store/store'
import { PlanCard } from '../components/PlanCard'

export function Home() {
  const data = useData()
  const { notebooks, books, studied, mistakes, outputs } = data
  const docs = useDocs()
  const name = useStore((s) => s.profiles.find((p) => p.id === s.activeId)?.name ?? '')
  const setup = useCurriculum()
  usePacks()
  // دفتر لكل مادة (يُنشأ تلقائياً)، ثم بقية دفاتر الطالب
  const subjectNbs = [...notebooks].filter((n) => n.bookIds.length).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)

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
          <p className="muted">اختر مادة ثم درساً، وادرسه مع رفيق: شرح خطوة خطوة، وأسئلة، وملخصات واختبارات جاهزة من كتابك.</p>
        </div>
      </header>

      <PlanCard />
      <section aria-labelledby="subj-h">
        <div className="section-head">
          <h2 id="subj-h">موادي</h2>
          {setup.phase === 'books' && <small className="muted">يجهّز كتب المنهج على هذا الجهاز ({num(setup.done)} من {num(setup.total)})…</small>}
        </div>
        {subjectNbs.length === 0 ? (
          <div className="start-empty panel">
            {setup.phase === 'error' ? (
              <>
                <p className="muted">تعذّر تجهيز كتب المنهج على هذا الجهاز. تحقق من الاتصال ثم أعد المحاولة.</p>
                <button className="btn btn-primary" onClick={() => void setupCurriculum()}>إعادة المحاولة</button>
              </>
            ) : (
              <p className="thinking">يجهّز رفيق موادك وكتبها لأول مرة…</p>
            )}
          </div>
        ) : (
          <div className="subject-grid">
            {subjectNbs.map((n) => {
              const nbBooks = n.bookIds.filter((id) => isSearchable(docs[id]))
              const lessons = nbBooks.flatMap((id) => (docs[id]?.sections ?? []).map((sec) => ({ id, sec })))
              const readyN = lessons.filter((x) => packOf(x.id, x.sec.id)).length
              const doneN = Object.values(studied).filter((x) => nbBooks.includes(x.bookId) && (x.explained || x.taught || x.checks)).length
              return (
                <Link key={n.id} to={`/notebooks/${n.id}`} className="subject-card" data-hue={n.hue}>
                  <span className="spine" aria-hidden="true" />
                  <strong>{n.title}</strong>
                  <small className="muted">
                    {booksCount(nbBooks.length)}، {lessonsCount(lessons.length)}
                  </small>
                  <small className="muted">
                    {readyN ? `محتوى جاهز: ${lessonsCount(readyN)}` : 'المحتوى الجاهز قيد الإعداد'}
                    {doneN ? `، درست ${lessonsCount(doneN)}` : ''}
                  </small>
                </Link>
              )
            })}
          </div>
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

    </div>
  )
}
