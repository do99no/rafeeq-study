import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, BookOpen, BookOpenCheck, CalendarDays, ChartNoAxesColumn, ClipboardList, History, KeyRound, LoaderCircle, LogOut, RefreshCw, ShieldCheck, TriangleAlert, UserRound, Zap } from 'lucide-react'
import { DailyBars, dur, SplitBars, Trend } from '../components/admin/Charts'
import { num } from '../lib/format'
import { go, Link } from '../router'
import { adminSetPassword, api, changePassword, logout, ServerError } from '../services/server/account'
import { toast } from '../store/toast'
import { AdminAI } from './AdminAI'
import { AdminContent } from './AdminContent'
import { AdminPlacement } from './AdminPlacement'
import { AdminProgress } from './AdminProgress'
import { coverage, EXAM_SOURCES } from '../services/study/exams'

interface Summary {
  id: string
  name: string
  totalMs: number
  todayMs: number
  weekMs: number
  monthMs: number
  sessions: number
  avgSessionMs: number
  hidden: number
  returns: number
  offline: number
  idle: number
  endReasons: Record<string, number>
  last: { at: number; subject?: string; book?: string; lesson?: string } | null
  lessonsDone: number
  lessonsReview: number
  quizzes: number
  avgScore: number | null
  trend: { at: number; pct: number; title: string }[]
  weak: { topic: string; book: string; n: number; last: number }[]
  cards: { due: number; hard: number; total: number }
  plan: Plan | null
  adherence: number | null
  planLessons: (PlanLesson & { done: boolean })[]
  insights: { kind: string; text: string; topics?: string[] }[]
  synced: number | null
  training?: { worksheets: number; examAttempts: number; mixed: number; bank: number }
  studyDays?: number
  lastLogin?: number | null
  logins?: number
  activities?: number
  perBook?: { book: string; lessons: number; done: number; review: number; ms: number }[]
}
interface Detail extends Summary {
  daily: { day: string; ms: number }[]
  bySubject: { name: string; ms: number }[]
  byBook: { name: string; ms: number }[]
  byLesson: { name: string; ms: number }[]
  lessons: { key: string; title: string; done: boolean; review: boolean; ratio: number | null; quiz: number | null; at: number }[]
  times: { day: string; subject: string; book: string; lesson: string; ms: number }[]
  recent: { id: string; prev: string | null; start: number; last: number; end: number | null; activeMs: number; pausedMs: number; hidden: number; returns: number; offline: number; idle: number; reason: string | null; subject?: string; book?: string; lesson?: string; tasks: Record<string, number> }[]
}
interface PlanLesson {
  key: string
  title: string
  bookId?: string
  book?: string
  due?: string
}
interface Plan {
  dailyMin: number
  weeklyMin: number
  weeklyQuizzes: number
  idleMin: number
  reviewWeak: boolean
  examDate?: string
  reviewDates: { date: string; note: string }[]
  note: string
  lessons: PlanLesson[]
}

const when = (t: number) => new Date(t).toLocaleString('ar', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const REASON: Record<string, string> = { left: 'غادر الدراسة داخل الموقع', pagehide: 'غادر الموقع أو أغلق الصفحة', logout: 'سجّل الخروج', idle: 'خمول طويل', hidden: 'الصفحة مخفية مدة طويلة', unknown: 'انقطاع غير معروف السبب' }
export const EVENT: Record<string, string> = {
  session_start: 'بدأ جلسة دراسة', session_end: 'أنهى جلسة الدراسة', hidden: 'أخفى صفحة الدراسة', visible: 'عاد إلى الدراسة', idle: 'توقف عن التفاعل (خمول)', active: 'عاد إلى التفاعل',
  offline: 'انقطع الاتصال', online: 'عاد الاتصال', pagehide: 'غادر الموقع أو أغلق الصفحة', logout: 'سجّل الخروج', book_start: 'بدأ دراسة كتاب', lesson_open: 'فتح درساً',
  explain: 'طلب شرحاً', explain_done: 'أكمل شرحاً', teach: 'تعليم خطوة بخطوة', answer_right: 'أجاب إجابة صحيحة', answer_wrong: 'أخطأ في سؤال', answer_partial: 'إجابة صحيحة جزئياً',
  quiz_done: 'أكمل اختباراً', summary: 'أنشأ ملخصاً', cards: 'أنشأ بطاقات', cards_review: 'راجع بطاقات', weak_revisit: 'عاد إلى موضوع ضعيف', read_page: 'قرأ صفحة من الكتاب', paragraph: 'سأل عن فقرة', output_open: 'فتح مادة محفوظة',
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-v">{value}</span>
      <span className="stat-l">{label}</span>
      {hint && <small className="muted">{hint}</small>}
    </div>
  )
}

function useLoad<T>(path: string | null, dep: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    setErr('')
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(e instanceof ServerError && e.code === 'network' ? 'تعذّر الاتصال بالخادم.' : 'تعذّر تحميل البيانات.'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...dep])
  return { data, err, reload: () => setN((x) => x + 1) }
}

function StudentCard({ s }: { s: Summary }) {
  return (
    <article className="panel admin-card">
      <header className="admin-card-head">
        <span className="who-avatar" aria-hidden="true">
          {s.name.slice(0, 1)}
        </span>
        <div className="grow">
          <h2>{s.name}</h2>
          <p className="muted">
            {s.last ? (
              <>
                آخر دراسة: {when(s.last.at)}
                {s.last.lesson && (
                  <>
                    {' · '}
                    <bdi>{s.last.lesson}</bdi>
                  </>
                )}
                {s.last.book && (
                  <>
                    {' ('}
                    <bdi>{s.last.book}</bdi>)
                  </>
                )}
              </>
            ) : (
              'لم يدرس بعد'
            )}
          </p>
        </div>
        <Link to={`/admin/s/${s.id}`} className="btn btn-sm btn-primary">
          ملف الطالب
        </Link>
      </header>
      <div className="stats">
        <Stat label="اليوم" value={dur(s.todayMs)} hint={s.plan?.dailyMin ? `الهدف ${dur(s.plan.dailyMin * 60_000)}` : undefined} />
        <Stat label="آخر 7 أيام" value={dur(s.weekMs)} />
        <Stat label="هذا الشهر" value={dur(s.monthMs)} />
        <Stat label="الإجمالي الفعلي" value={dur(s.totalMs)} />
        <Stat label="أيام الدراسة" value={num(s.studyDays ?? 0)} />
        <Stat label="آخر دخول" value={s.lastLogin ? when(s.lastLogin) : '—'} hint={s.logins ? `${num(s.logins)} مرات دخول` : undefined} />
        <Stat label="أنشطة تعليمية" value={num(s.activities ?? 0)} />
        <Stat label="جلسات الدراسة" value={num(s.sessions)} hint={s.sessions ? `متوسطها ${dur(s.avgSessionMs)}` : undefined} />
        <Stat label="إخفاء الصفحة / عودة" value={`${num(s.hidden)} / ${num(s.returns)}`} />
        <Stat label="انقطاع الاتصال" value={num(s.offline)} />
        <Stat label="دروس مكتملة" value={num(s.lessonsDone)} hint={s.lessonsReview ? `${num(s.lessonsReview)} تحتاج مراجعة` : undefined} />
        <Stat label="اختبارات" value={num(s.quizzes)} hint={s.avgScore !== null ? `متوسط ${num(s.avgScore)}٪` : undefined} />
        <Stat label="بطاقات مستحقة" value={num(s.cards.due)} hint={s.cards.hard ? `${num(s.cards.hard)} صعبة` : undefined} />
        <Stat label="التدريب" value={`${num(s.training?.examAttempts ?? 0)} امتحانات`} hint={`${num(s.training?.worksheets ?? 0)} أوراق عمل · بنك ${num(s.training?.bank ?? 0)} سؤالاً`} />
        <Stat label="الالتزام بالخطة" value={s.adherence === null ? '—' : `${num(s.adherence)}٪`} hint={s.adherence === null ? 'لا خطة يومية' : 'آخر 7 أيام'} />
      </div>
      <h3 className="mini-h">تطور النتائج</h3>
      <Trend data={s.trend} />
      {!!s.weak.length && (
        <>
          <h3 className="mini-h">نقاط ضعف متكررة</h3>
          <ul className="tags">
            {s.weak.slice(0, 6).map((w) => (
              <li key={w.topic}>
                {w.topic} <small className="muted">×{num(w.n)}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {s.insights.map((i) => (
        <p key={i.kind} className="insight">
          <TriangleAlert aria-hidden="true" /> {i.text}
        </p>
      ))}
    </article>
  )
}

/** حالة الخدمات في مكان واحد: النسخ الاحتياطية، واختبارات تحديد المستوى، والذكاء الاصطناعي. لا مفاتيح ولا بيانات حساسة */
function SystemStatus() {
  const amna = useLoad<{ backups: { at: number; size: number }[] }>('/admin/backups/amna')
  const mohamed = useLoad<{ backups: { at: number; size: number }[] }>('/admin/backups/mohamed')
  const pl = useLoad<{ banks: { subject: string; n: number; published: boolean }[] }>('/admin/placement')
  const ai = useLoad<{ providers: { configured: boolean; models: Record<string, string> }[] }>('/status')
  const day = 86_400_000
  const backup = (name: string, d: { backups: { at: number; size: number }[] } | null, err: string) => {
    const last = d?.backups[0]
    const ok = !!last && Date.now() - last.at < 2 * day
    return (
      <li data-ok={ok}>
        <strong>نسخة {name}</strong>
        <span className="muted">{err ? 'تعذّرت القراءة' : !d ? '…' : last ? `آخرها ${new Date(last.at).toLocaleString('ar-EG')} (${num(Math.round(last.size / 1024))} ك.ب)${ok ? '' : ' · أقدم من يومين'}` : 'لا نسخ بعد'}</span>
      </li>
    )
  }
  const banks = pl.data?.banks ?? []
  const pub = banks.filter((b) => b.published)
  const p = ai.data?.providers[0]
  return (
    <section className="panel sys-status">
      <h2 className="mini-h">حالة الخدمات</h2>
      <ul className="sys-list">
        {backup('أمنة', amna.data, amna.err)}
        {backup('محمد', mohamed.data, mohamed.err)}
        <li data-ok={banks.length > 0 && pub.length === banks.length}>
          <strong>تحديد المستوى</strong>
          <span className="muted">{pl.err ? 'تعذّرت القراءة' : !pl.data ? '…' : `منشور ${num(pub.length)} من ${num(banks.length)} مواد${pub.length < banks.length ? `؛ بانتظار: ${banks.filter((b) => !b.published).map((b) => b.subject).join('، ')}` : ''}`}</span>
        </li>
        <li data-ok={!!p?.configured}>
          <strong>الذكاء الاصطناعي</strong>
          <span className="muted">{ai.err ? 'تعذّرت القراءة' : !ai.data ? '…' : p?.configured ? `يعمل${p.models.embed ? '، والبحث الدلالي متاح' : ''}` : 'غير مهيأ'}</span>
        </li>
        <li data-ok={false}>
          <strong>الصوت التعليمي</strong>
          <span className="muted">صوت المتصفح حالياً؛ الصوت المستنسخ بانتظار تجربتك واعتمادك</span>
        </li>
      </ul>
    </section>
  )
}

function Overview() {
  const { data, err, reload } = useLoad<{ students: Summary[]; at: number }>('/admin/overview')
  return (
    <div className="page">
      <header className="page-head">
        <h1>لوحة متابعة الطلاب</h1>
        <button className="btn btn-sm" onClick={reload}>
          <RefreshCw aria-hidden="true" /> تحديث
        </button>
      </header>
      <p className="muted">الوقت المحتسب هو الوقت النشط فقط: صفحة الدراسة مرئية، وتفاعل خلال مهلة الخمول، واتصال قائم.</p>
      {err && <p className="warn">{err}</p>}
      {!data && !err && <p className="page-loading">جارٍ التحميل…</p>}
      <div className="admin-grid">{data?.students.map((s) => <StudentCard key={s.id} s={s} />)}</div>
      <SystemStatus />
      <section className="panel">
        <h2 className="mini-h">المحتوى التدريبي وما ينقص</h2>
        <p className="muted small">امتحانات الشهادة المتوفرة: أبريل 2020 لست مواد (من موقع حكومي، تُفتح من مصدرها)، وامتحان تجريبي للعلوم الهندسية. لا نموذج إجابة رسمياً لأي سنة. ومن الكتب: {EXAM_SOURCES.map((x) => x.title).join('، ')}.</p>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>المادة</th>
                <th>امتحانات سابقة</th>
                <th>نماذج</th>
                <th>بنمط الشهادة</th>
                <th>ما ينقص</th>
              </tr>
            </thead>
            <tbody>
              {coverage().map((c) => (
                <tr key={c.subject}>
                  <td>{c.subject}</td>
                  <td>{num(c.past)}</td>
                  <td>{num(c.model)}</td>
                  <td>{num(c.style)}</td>
                  <td>{c.past ? 'سنوات غير 2020، ونماذج الإجابة الرسمية' : 'امتحانات السنوات السابقة ونماذج إجابتها الرسمية'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ===== ملف الطالب =====
const TABS = [
  { id: 'summary', label: 'الملخص والتقارير', icon: ChartNoAxesColumn },
  { id: 'log', label: 'سجل النشاط', icon: History },
  { id: 'plan', label: 'الخطة', icon: CalendarDays },
  { id: 'study', label: 'مواد الدراسة', icon: BookOpen },
  { id: 'account', label: 'الحساب والنسخ', icon: KeyRound },
] as const

type Period = 'day' | 'week' | 'month'
function SummaryTab({ d }: { d: Detail }) {
  const [period, setPeriod] = useState<Period>('week')
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30
  const keep = new Set(d.daily.slice(-days).map((x) => x.day))
  const rows = d.times.filter((t) => keep.has(t.day))
  const group = (k: 'subject' | 'book' | 'lesson') => Object.values(rows.reduce<Record<string, { name: string; ms: number }>>((m, r) => ((m[r[k] || '—'] = { name: r[k] || '—', ms: (m[r[k] || '—']?.ms ?? 0) + r.ms }), m), {})).sort((a, b) => b.ms - a.ms)
  const total = rows.reduce((s, r) => s + r.ms, 0)
  return (
    <>
      <div className="stats">
        <Stat label="اليوم" value={dur(d.todayMs)} />
        <Stat label="آخر 7 أيام" value={dur(d.weekMs)} />
        <Stat label="هذا الشهر" value={dur(d.monthMs)} />
        <Stat label="الإجمالي" value={dur(d.totalMs)} />
        <Stat label="جلسات" value={num(d.sessions)} hint={`متوسط ${dur(d.avgSessionMs)}`} />
        <Stat label="إخفاء الصفحة" value={num(d.hidden)} />
        <Stat label="عودة" value={num(d.returns)} />
        <Stat label="خمول" value={num(d.idle)} />
        <Stat label="انقطاع اتصال" value={num(d.offline)} />
      </div>
      {d.insights.map((i) => (
        <p key={i.kind} className="insight">
          <TriangleAlert aria-hidden="true" /> {i.text}
          {i.topics?.length ? <small> الموضوعات: {i.topics.join('، ')}</small> : null}
        </p>
      ))}
      <section className="panel">
        <h3 className="mini-h">ساعات الدراسة اليومية (30 يوماً)</h3>
        <DailyBars data={d.daily} target={d.plan?.dailyMin ? d.plan.dailyMin * 60_000 : undefined} />
      </section>
      <section className="panel">
        <div className="page-head">
          <h3 className="mini-h">تقرير التوزيع</h3>
          <div className="seg" role="group" aria-label="الفترة">
            {(['day', 'week', 'month'] as Period[]).map((p) => (
              <button key={p} className={period === p ? 'on' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {{ day: 'اليوم', week: 'الأسبوع', month: 'الشهر' }[p]}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">المجموع: {dur(total)}</p>
        <h4>حسب المادة</h4>
        <SplitBars data={group('subject')} />
        <h4>حسب الكتاب</h4>
        <SplitBars data={group('book')} />
        <h4>حسب الدرس</h4>
        <SplitBars data={group('lesson').slice(0, 12)} />
      </section>
      <section className="panel">
        <h3 className="mini-h">تطور النتائج</h3>
        <Trend data={d.trend} />
      </section>
      <section className="panel">
        <h3 className="mini-h">التقدم في كل كتاب</h3>
        {!d.perBook?.length && <p className="muted">لم يدرس درساً بعد.</p>}
        <ul className="admin-list">
          {d.perBook?.map((b) => (
            <li key={b.book}>
              <bdi className="grow">{b.book}</bdi>
              <small className="muted">
                {num(b.done)} مكتمل من {num(b.lessons)} درساً درسها{b.review ? ` · ${num(b.review)} تحتاج مراجعة` : ''} · {dur(b.ms)}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h3 className="mini-h">الدروس</h3>
        {!d.lessons.length && <p className="muted">لم يدرس درساً بعد.</p>}
        <ul className="admin-list">
          {d.lessons.map((l) => (
            <li key={l.key}>
              <bdi className="grow">{l.title}</bdi>
              <span className={l.done ? 'pill ok' : l.review ? 'pill bad' : 'pill'}>{l.done ? 'مكتمل' : l.review ? 'يحتاج مراجعة' : 'جارٍ'}</span>
              <small className="muted">
                {l.ratio !== null && `أسئلة الفهم ${num(Math.round(l.ratio * 100))}٪`} {l.quiz !== null && `· الاختبار ${num(Math.round(l.quiz * 100))}٪`}
              </small>
            </li>
          ))}
        </ul>
        <p className="muted small">«مكتمل»: أنهى التعليم خطوة بخطوة، أو شُرح الدرس ونجح في أسئلة الفهم (بنسبة ٦٠٪ فأكثر في سؤالين) أو في اختبار الدرس.</p>
      </section>
      <section className="panel">
        <h3 className="mini-h">نقاط الضعف والبطاقات</h3>
        <p>
          بطاقات مستحقة للمراجعة: {num(d.cards.due)} من {num(d.cards.total)}، منها {num(d.cards.hard)} صعبة.
        </p>
        <ul className="admin-list">
          {d.weak.map((w) => (
            <li key={w.topic}>
              <span className="grow">{w.topic}</span>
              <small className="muted">
                {w.book} · {num(w.n)} أخطاء · آخرها {when(w.last)}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h3 className="mini-h">جلسات الدراسة الأخيرة</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>البداية</th>
                <th>نشط</th>
                <th>متوقف</th>
                <th>إخفاء/عودة</th>
                <th>انقطاع</th>
                <th>الدرس</th>
                <th>النهاية</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((s) => (
                <tr key={s.id}>
                  <td>
                    {when(s.start)}
                    {s.prev && <small className="muted"> (متابعة لجلسة سابقة)</small>}
                  </td>
                  <td>{dur(s.activeMs)}</td>
                  <td>{dur(s.pausedMs)}</td>
                  <td>
                    {num(s.hidden)}/{num(s.returns)}
                  </td>
                  <td>{num(s.offline)}</td>
                  <td>
                    <bdi>{s.lesson ?? s.book ?? '—'}</bdi>
                  </td>
                  <td>{s.end ? REASON[s.reason ?? ''] ?? s.reason : 'جارية'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function LogTab({ id, d }: { id: string; d: Detail }) {
  const [day, setDay] = useState(() => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10))
  const [f, setF] = useState({ subject: '', book: '', lesson: '' })
  const from = Date.parse(`${day}T00:00:00+02:00`)
  const qs = new URLSearchParams({ user: id, from: String(from), to: String(from + 86400_000), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })
  const { data, err } = useLoad<{ events: { at: number; type: string; subject?: string; book?: string; lesson?: string; detail?: string; queued: number }[] }>(`/admin/events?${qs}`)
  const opts = (k: 'subject' | 'book' | 'lesson') => [...new Set(d.times.map((t) => t[k]).filter(Boolean))]
  return (
    <section className="panel">
      <div className="filters">
        <label className="field">
          <span>اليوم</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        {(['subject', 'book', 'lesson'] as const).map((k) => (
          <label key={k} className="field">
            <span>{{ subject: 'المادة', book: 'الكتاب', lesson: 'الدرس' }[k]}</span>
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
              <option value="">الكل</option>
              {opts(k).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {err && <p className="warn">{err}</p>}
      {data && !data.events.length && <p className="muted">لا نشاط في هذا اليوم.</p>}
      <ol className="timeline">
        {data?.events.map((e, i) => (
          <li key={i} data-type={e.type}>
            <time>{new Date(e.at).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' })}</time>
            <div>
              <strong>{EVENT[e.type] ?? e.type}</strong>
              {e.detail && <span> · {e.detail}</span>}
              {(e.lesson || e.book) && (
                <small className="muted">
                  {' '}
                  — <bdi>{e.lesson ?? ''}</bdi>
                  {e.book ? ` (${e.book})` : ''}
                </small>
              )}
              {!!e.queued && <small className="muted"> · وصل بعد عودة الاتصال</small>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PlanTab({ id, d, onSaved }: { id: string; d: Detail; onSaved: () => void }) {
  const [p, setP] = useState<Plan>(() => d.plan ?? { dailyMin: 120, weeklyMin: 720, weeklyQuizzes: 3, idleMin: 2, reviewWeak: true, reviewDates: [], note: '', lessons: [] })
  const [busy, setBusy] = useState(false)
  const [catalog, setCatalog] = useState<{ id: string; title: string; subject: string; sections: { id: string; title: string; level: number; page: number; endPage: number }[] }[] | null>(null)
  const [book, setBook] = useState('')
  const [catErr, setCatErr] = useState('')
  const loadCatalog = async () => {
    setCatErr('')
    try {
      const { serverLibraryCode } = await import('../services/server/account')
      const { lessonCatalog, savedCode } = await import('../services/books/library')
      const code = (await serverLibraryCode().catch(() => null)) || savedCode()
      if (!code) return setCatErr('لاختيار الدروس: افتح المكتبة على هذا الجهاز برمزها مرة واحدة، أو أضف LIBRARY_CODE إلى أسرار الخادم.')
      setCatalog(await lessonCatalog(code))
    } catch {
      setCatErr('تعذّر تحميل فهارس الدروس.')
    }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`/admin/plan/${id}`, { method: 'PUT', body: p })
      toast('حُفظت الخطة.')
      onSaved()
    } catch {
      toast('تعذّر حفظ الخطة.')
    } finally {
      setBusy(false)
    }
  }
  const nb = (k: keyof Plan) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) })
  const cur = catalog?.find((b) => b.id === book)
  const today = d.daily.at(-1)?.ms ?? 0
  return (
    <form className="panel form" onSubmit={save}>
      <div className="stats">
        <Stat label="اليوم: الفعلي / المستهدف" value={`${dur(today)} / ${dur(p.dailyMin * 60_000)}`} />
        <Stat label="الأسبوع: الفعلي / المستهدف" value={`${dur(d.weekMs)} / ${dur(p.weeklyMin * 60_000)}`} />
        <Stat label="الدروس المطلوبة" value={`${num(d.planLessons.filter((l) => l.done).length)} / ${num(d.planLessons.length)}`} />
        <Stat label="متوسط النتائج" value={d.avgScore === null ? '—' : `${num(d.avgScore)}٪`} />
        <Stat label="الالتزام (7 أيام)" value={d.adherence === null ? '—' : `${num(d.adherence)}٪`} />
      </div>
      <div className="grid-2">
        <label className="field">
          <span>هدف يومي (دقائق دراسة فعلية)</span>
          <input type="number" min={0} max={960} value={p.dailyMin} onChange={nb('dailyMin')} />
        </label>
        <label className="field">
          <span>هدف أسبوعي (دقائق)</span>
          <input type="number" min={0} max={6720} value={p.weeklyMin} onChange={nb('weeklyMin')} />
        </label>
        <label className="field">
          <span>اختبارات مطلوبة أسبوعياً</span>
          <input type="number" min={0} max={50} value={p.weeklyQuizzes} onChange={nb('weeklyQuizzes')} />
        </label>
        <label className="field">
          <span>مهلة الخمول (دقائق دون تفاعل يتوقف بعدها الاحتساب)</span>
          <input type="number" min={1} max={30} value={p.idleMin} onChange={nb('idleMin')} />
        </label>
        <label className="field">
          <span>موعد الامتحان</span>
          <input type="date" value={p.examDate ?? ''} onChange={(e) => setP({ ...p, examDate: e.target.value || undefined })} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={p.reviewWeak} onChange={(e) => setP({ ...p, reviewWeak: e.target.checked })} /> مراجعة الموضوعات الضعيفة ضمن الخطة
        </label>
      </div>
      <h3 className="mini-h">دروس يجب إكمالها</h3>
      <ul className="admin-list">
        {p.lessons.map((l, i) => {
          const done = d.planLessons.find((x) => x.key === l.key)?.done
          return (
            <li key={l.key}>
              <span className="grow">
                {l.title} <small className="muted">{l.book}</small>
              </span>
              <input type="date" aria-label="الموعد" value={l.due ?? ''} onChange={(e) => setP({ ...p, lessons: p.lessons.map((x, k) => (k === i ? { ...x, due: e.target.value || undefined } : x)) })} />
              <span className={done ? 'pill ok' : 'pill'}>{done ? 'مكتمل' : 'لم يكتمل'}</span>
              <button type="button" className="btn btn-sm" onClick={() => setP({ ...p, lessons: p.lessons.filter((_, k) => k !== i) })}>
                حذف
              </button>
            </li>
          )
        })}
      </ul>
      {!catalog ? (
        <button type="button" className="btn btn-sm" onClick={() => void loadCatalog()}>
          <ClipboardList aria-hidden="true" /> إضافة دروس من الكتب
        </button>
      ) : (
        <div className="grid-2">
          <label className="field">
            <span>الكتاب</span>
            <select value={book} onChange={(e) => setBook(e.target.value)}>
              <option value="">اختر</option>
              {catalog.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          {cur && (
            <label className="field">
              <span>الدرس</span>
              <select
                value=""
                onChange={(e) => {
                  const s = cur.sections.find((x) => x.id === e.target.value)
                  if (s) setP({ ...p, lessons: [...p.lessons, { key: `${cur.id}:${s.page}-${s.endPage}`, title: s.title, bookId: cur.id, book: cur.title }] })
                }}
              >
                <option value="">اختر درساً لإضافته</option>
                {cur.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.level === 2 ? '— ' : ''}
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {catErr && <p className="warn">{catErr}</p>}
      <h3 className="mini-h">مواعيد مراجعة</h3>
      <ul className="admin-list">
        {p.reviewDates.map((r, i) => (
          <li key={i}>
            <input type="date" value={r.date} onChange={(e) => setP({ ...p, reviewDates: p.reviewDates.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)) })} />
            <input className="grow" value={r.note} placeholder="ماذا يراجع" onChange={(e) => setP({ ...p, reviewDates: p.reviewDates.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)) })} />
            <button type="button" className="btn btn-sm" onClick={() => setP({ ...p, reviewDates: p.reviewDates.filter((_, k) => k !== i) })}>
              حذف
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" onClick={() => setP({ ...p, reviewDates: [...p.reviewDates, { date: new Date().toISOString().slice(0, 10), note: '' }] })}>
        إضافة موعد
      </button>
      <label className="field">
        <span>ملاحظة للطالب</span>
        <textarea value={p.note} maxLength={500} onChange={(e) => setP({ ...p, note: e.target.value })} />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy && <LoaderCircle className="spin" aria-hidden="true" />} حفظ الخطة
      </button>
    </form>
  )
}

/** للاطلاع فقط: الدفاتر والمحادثات والمخرجات كما حفظها الطالب */
function StudyTab({ id }: { id: string }) {
  const { data, err } = useLoad<{ docs: { key: string; json: string; updated: number }[] }>(`/admin/data/${id}`)
  const [open, setOpen] = useState<string | null>(null)
  const core = useMemo(() => {
    const c = data?.docs.find((x) => x.key === 'core')
    return c ? JSON.parse(c.json) : null
  }, [data])
  const chats = data?.docs.filter((x) => x.key.startsWith('chat:')) ?? []
  if (err) return <p className="warn">{err}</p>
  if (!data) return <p className="page-loading">جارٍ التحميل…</p>
  const msgs = open ? (JSON.parse(chats.find((c) => c.key === open)?.json ?? '[]') as { role: string; text: string; createdAt: number }[]) : []
  return (
    <section className="panel">
      <p className="muted">للاطلاع فقط. آخر مزامنة من جهاز الطالب: {core && data.docs.find((x) => x.key === 'core') ? when(data.docs.find((x) => x.key === 'core')!.updated) : '—'}</p>
      <h3 className="mini-h">المخرجات المحفوظة</h3>
      <ul className="admin-list">
        {(core?.outputs ?? []).map((o: { id: string; title: string; data: { kind: string }; createdAt: number }) => (
          <li key={o.id}>
            <span className="grow">{o.title}</span>
            <small className="muted">
              {{ summary: 'ملخص', quiz: 'اختبار', cards: 'بطاقات', mindmap: 'خريطة', note: 'ملاحظة', compare: 'مقارنة' }[o.data.kind] ?? o.data.kind} · {when(o.createdAt)}
            </small>
          </li>
        ))}
      </ul>
      <h3 className="mini-h">المحادثات</h3>
      <ul className="admin-list">
        {chats.map((c) => (
          <li key={c.key}>
            <button className="text-link grow" onClick={() => setOpen(open === c.key ? null : c.key)}>
              {(JSON.parse(c.json) as { role: string; text: string }[]).find((m) => m.role === 'user')?.text.slice(0, 80) ?? 'محادثة'}
            </button>
            <small className="muted">{when(c.updated)}</small>
          </li>
        ))}
      </ul>
      {open && (
        <div className="admin-chat">
          {msgs.map((m, i) => (
            <p key={i} className={m.role === 'user' ? 'msg-user-ro' : 'msg-ai-ro'}>
              {m.text}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

function AccountTab({ id, name }: { id: string; name: string }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, reload } = useLoad<{ backups: { id: number; at: number; why: string; size: number }[] }>(`/admin/backups/${id}`)
  const setPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await adminSetPassword(id, pw)
      setPw('')
      toast(`حُددت كلمة مرور ${name}، وانتهت جلساته المفتوحة على الأجهزة الأخرى.`)
    } catch (x) {
      toast(x instanceof ServerError && x.code === 'weak_password' ? 'كلمة المرور يجب ألا تقل عن 8 أحرف.' : 'تعذّر الحفظ.')
    } finally {
      setBusy(false)
    }
  }
  const restore = async (b: number) => {
    if (!confirm('استعادة هذه النسخة تستبدل بيانات الطالب الحالية (تُحفظ نسخة منها أولاً). متابعة؟')) return
    try {
      await api('/admin/restore', { body: { userId: id, backupId: b } })
      toast('استُعيدت النسخة. ستظهر على جهاز الطالب حين يفتح رفيق.')
      reload()
    } catch {
      toast('تعذّرت الاستعادة.')
    }
  }
  return (
    <>
      <form className="panel form" onSubmit={setPassword}>
        <h3 className="mini-h">كلمة مرور {name}</h3>
        <p className="muted">تحديد كلمة مرور جديدة أو إعادة تعيينها. أبلغها للطالب بنفسك، ولا ترسلها في محادثة عامة.</p>
        <label className="field">
          <span>كلمة المرور الجديدة (8 أحرف على الأقل)</span>
          <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" dir="auto" />
        </label>
        <button className="btn btn-primary" disabled={busy || pw.length < 8}>
          حفظ كلمة المرور
        </button>
      </form>
      <section className="panel">
        <h3 className="mini-h">النسخ الاحتياطية</h3>
        <p className="muted">نسخة تلقائية يومية تُحفظ 30 يوماً، ونسخة قبل كل استعادة.</p>
        {!data?.backups.length && <p className="muted">لا نسخ بعد.</p>}
        <ul className="admin-list">
          {data?.backups.map((b) => (
            <li key={b.id}>
              <span className="grow">
                {when(b.at)} <small className="muted">{{ daily: 'يومية', 'before-restore': 'قبل استعادة' }[b.why] ?? b.why}</small>
              </span>
              <small className="muted">{num(Math.round(b.size / 1024))} ك.ب</small>
              <button className="btn btn-sm" onClick={() => void restore(b.id)}>
                استعادة
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function StudentPage({ id }: { id: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('summary')
  const { data, err, reload } = useLoad<Detail>(`/admin/student/${id}`)
  return (
    <div className="page">
      <Link to="/admin" className="text-link back-link">
        <ArrowRight aria-hidden="true" /> لوحة المتابعة
      </Link>
      <header className="page-head">
        <h1>
          <UserRound aria-hidden="true" /> {data?.name ?? '…'}
        </h1>
        <button className="btn btn-sm" onClick={reload}>
          <RefreshCw aria-hidden="true" /> تحديث
        </button>
      </header>
      <nav className="tabs" aria-label="أقسام ملف الطالب">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>
      {err && <p className="warn">{err}</p>}
      {!data && !err && <p className="page-loading">جارٍ التحميل…</p>}
      {data && tab === 'summary' && <SummaryTab d={data} />}
      {data && tab === 'log' && <LogTab id={id} d={data} />}
      {data && tab === 'plan' && <PlanTab id={id} d={data} onSaved={reload} />}
      {data && tab === 'study' && <StudyTab id={id} />}
      {data && tab === 'account' && <AccountTab id={id} name={data.name} />}
    </div>
  )
}

function OwnAccount() {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await changePassword(cur, next)
      toast('تغيّرت كلمة المرور. سجّل الدخول من جديد.')
      await logout()
    } catch (x) {
      toast(x instanceof ServerError && x.code === 'weak_password' ? 'كلمة المرور يجب ألا تقل عن 8 أحرف.' : 'كلمة المرور الحالية غير صحيحة.')
    }
  }
  return (
    <div className="page">
      <h1>حساب المسؤول</h1>
      <form className="panel form" onSubmit={save}>
        <label className="field">
          <span>كلمة المرور الحالية</span>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
        </label>
        <label className="field">
          <span>كلمة المرور الجديدة</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        <button className="btn btn-primary">تغيير كلمة المرور</button>
      </form>
      <button className="btn" onClick={() => void logout()}>
        <LogOut aria-hidden="true" /> تسجيل الخروج
      </button>
    </div>
  )
}

/** تطبيق المسؤول: لا يصل إليه الطالب (الخادم يرفض طلباته أيضاً) */
export default function AdminApp({ path }: { path: string }) {
  const sid = path.match(/^\/admin\/s\/([a-z]+)$/)?.[1]
  useEffect(() => {
    if (!path.startsWith('/admin')) go('/admin')
  }, [path])
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link to="/admin" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck />
          </span>
          <span className="brand-text">
            <strong>رفيق</strong>
            <small>لوحة المسؤول</small>
          </span>
        </Link>
        <span className="grow" />
        <Link to="/admin/content" className="btn btn-sm">
          <BookOpenCheck aria-hidden="true" /> جاهزية المحتوى
        </Link>
        <Link to="/admin/progress" className="btn btn-sm">
          <ChartNoAxesColumn aria-hidden="true" /> تقدم الطالبين
        </Link>
        <Link to="/admin/placement" className="btn btn-sm">
          <ClipboardList aria-hidden="true" /> تحديد المستوى
        </Link>
        <Link to="/admin/ai" className="btn btn-sm">
          <Zap aria-hidden="true" /> الذكاء الاصطناعي
        </Link>
        <Link to="/admin/me" className="btn btn-sm">
          <KeyRound aria-hidden="true" /> حسابي
        </Link>
      </header>
      <main className="main">{sid ? <StudentPage key={sid} id={sid} /> : path === '/admin/me' ? <OwnAccount /> : path === '/admin/ai' ? <AdminAI /> : path === '/admin/content' ? <AdminContent /> : path === '/admin/placement' ? <AdminPlacement /> : path === '/admin/progress' ? <AdminProgress /> : <Overview />}</main>
    </div>
  )
}
