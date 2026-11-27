import { ArrowLeft, Check, ChartNoAxesColumn, MessageCircleQuestion } from 'lucide-react'
import { logEvent } from '../services/server/tracker'
import { isDue, mastered, normalCards } from '../components/outputs/CardsView'
import { CiteLink } from '../components/RichText'
import { EmptyState } from '../components/EmptyState'
import { ago, num } from '../lib/format'
import { startStudy } from '../lib/study'
import { Link } from '../router'
import { actions, useData } from '../store/store'
import type { Mistake } from '../types'

/** التقدم: ما درسه الطالب، ونتائجه، والموضوعات التي يخطئ فيها */
export default function Progress() {
  const { studied, mistakes, attempts, outputs, books } = useData()
  const lessons = Object.values(studied).sort((a, b) => b.at - a.at)
  const open = mistakes.filter((m) => !m.resolved)
  const byTopic = [...open.reduce((m, x) => m.set(`${x.bookId}|${x.topic}`, [...(m.get(`${x.bookId}|${x.topic}`) ?? []), x]), new Map<string, Mistake[]>()).values()].sort((a, b) => b.length - a.length)
  const cards = outputs.flatMap((o) => (o.data.kind === 'cards' ? normalCards(o.data.cards, o.data.known) : []))
  const avg = attempts.length ? Math.round((attempts.reduce((s, a) => s + a.score / a.total, 0) / attempts.length) * 100) : 0
  const title = (id: string) => outputs.find((o) => o.id === id)?.title ?? 'اختبار محذوف'
  const bookTitle = (id: string) => books.find((b) => b.id === id)?.title ?? ''

  if (!lessons.length && !attempts.length && !mistakes.length && !cards.length)
    return (
      <div className="page">
        <header className="page-head">
          <h1>التقدم</h1>
        </header>
        <EmptyState icon={ChartNoAxesColumn} title="لم تبدأ بعد" text="ادرس درساً أو حلّ اختباراً، وسيظهر هنا ما أتقنته وما يحتاج إلى مراجعة.">
          <Link to="/" className="btn btn-primary">
            ابدأ الدراسة
          </Link>
        </EmptyState>
      </div>
    )

  return (
    <div className="page">
      <header className="page-head">
        <h1>التقدم</h1>
      </header>
      <ul className="stats">
        <li>
          <strong>{num(lessons.length)}</strong>
          <span>دروس درستها</span>
        </li>
        <li>
          <strong>{num(attempts.length)}</strong>
          <span>اختبارات محلولة{attempts.length ? `، المتوسط ${num(avg)}٪` : ''}</span>
        </li>
        <li>
          <strong>
            {num(cards.filter(mastered).length)}
            <small> من {num(cards.length)}</small>
          </strong>
          <span>بطاقات متقنة، مستحقة الآن {num(cards.filter((c) => isDue(c)).length)}</span>
        </li>
        <li>
          <strong>{num(byTopic.length)}</strong>
          <span>موضوعات تحتاج إلى مراجعة</span>
        </li>
      </ul>

      {byTopic.length > 0 && (
        <section className="panel" aria-labelledby="weak-h">
          <h2 id="weak-h">الموضوعات التي تحتاج إلى مراجعة</h2>
          <p className="muted">من أخطائك في الاختبارات وأسئلة الفهم.</p>
          <ul className="weak-list">
            {byTopic.map((list) => {
              const m = list[0]
              return (
                <li key={`${m.bookId}|${m.topic}`} className="weak-item">
                  <div className="grow">
                    <strong>{m.topic}</strong>
                    <small className="muted">
                      {m.bookTitle}، {num(list.length)} {list.length > 2 ? 'أخطاء' : 'خطأ'}، آخرها {ago(list[0].at)}
                    </small>
                    <ul className="weak-qs">
                      {list.slice(0, 3).map((x) => (
                        <li key={x.id}>
                          {x.q} <span className="muted">— الصحيح: {x.answer}</span>
                        </li>
                      ))}
                    </ul>
                    <CiteLink cite={{ n: 1, bookId: m.bookId, bookTitle: m.bookTitle, page: m.page, quote: m.q, chunk: 0 }} />
                  </div>
                  <div className="weak-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => (logEvent('weak_revisit', m.topic, { lesson: m.topic, book: m.bookTitle, bookId: m.bookId }), startStudy(m.bookId, undefined, { text: `راجع معي «${m.topic}»، فقد أخطأت في: ${list.slice(0, 3).map((x) => x.q).join('، ')}`, task: 'answer' }))}>
                      <MessageCircleQuestion aria-hidden="true" /> راجعه مع رفيق
                    </button>
                    <button className="btn btn-sm" onClick={() => actions.resolveMistakes(list.map((x) => x.id))}>
                      <Check aria-hidden="true" /> راجعته
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {lessons.length > 0 && (
        <section className="panel" aria-labelledby="les-h">
          <h2 id="les-h">الدروس التي درستها</h2>
          <ul className="saved">
            {lessons.map((s) => (
              <li key={s.key}>
                <button className="saved-open" onClick={() => startStudy(s.bookId, { bookId: s.bookId, from: s.from, to: s.to, title: s.title })}>
                  <span className="grow">
                    <span className="book-title">{s.title}</span>
                    <small className="muted">
                      {bookTitle(s.bookId)}
                      {s.explained ? '، شُرح كاملاً' : ''}
                      {s.taught ? `، تعلّمته حتى الخطوة ${num(s.taught.k)} من ${num(s.taught.n)}` : ''}
                      {s.checks ? `، أسئلة الفهم ${num(s.checks.right)} من ${num(s.checks.total)}` : ''}، {ago(s.at)}
                    </small>
                    {s.taught && <progress max={s.taught.n} value={s.taught.k} aria-label="التقدم في الدرس" />}
                  </span>
                  <ArrowLeft aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {attempts.length > 0 && (
        <section className="panel" aria-labelledby="att-h">
          <h2 id="att-h">نتائج الاختبارات</h2>
          <ul className="tries">
            {attempts.slice(0, 30).map((a) => (
              <li key={a.id}>
                <span className="grow">{title(a.outputId)}</span>
                <strong>
                  {num(a.score)} من {num(a.total)}
                </strong>
                <small className="muted">{ago(a.at)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
