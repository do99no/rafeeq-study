import { useEffect, useRef, useState } from 'react'
import { CircleCheck, EyeOff, LoaderCircle, Play, RefreshCw, Square, TriangleAlert } from 'lucide-react'
import { Link } from '../router'
import { ago, num } from '../lib/format'
import { refresh, Unavailable } from '../services/ai/manager'
import { hasPdf } from '../services/books/db'
import { downloadBook, lessonCatalog, openLibrary, type LibraryItem } from '../services/books/library'
import { docsReady, getDocs } from '../services/books/process'
import type { Section } from '../services/books/types'
import { api, serverLibraryCode } from '../services/server/account'
import type { PackInfo } from '../services/study/lessonPack'
import { lessonsOf, prepareLesson, setPackStatus, uploadPack } from '../services/study/prepare'
import { toast } from '../store/toast'

/** الأجزاء التي يُعدّ الدرس بها مكتملاً */
const CORE = ['steps', 'summary', 'quiz', 'cards']
const PART_LABEL: Record<string, string> = { steps: 'الشرح', summary: 'الملخصات', guide: 'دليل الدراسة', terms: 'المصطلحات', laws: 'القوانين', points: 'النقاط المهمة', mistakes: 'الأخطاء الشائعة', mindmap: 'الخريطة الذهنية', qa: 'سؤال وجواب', cards: 'البطاقات', quiz: 'الاختبارات', worksheet: 'ورقة العمل' }
// الرياضيات أولاً، ثم المواد العلمية، ثم بقية المواد
const ORDER = ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء', 'العلوم الهندسية', 'اللغة العربية', 'اللغة الإنجليزية', 'التربية الإسلامية']

interface Book {
  item: LibraryItem
  lessons: Section[]
}
type Job = { bookId: string; sectionId: string; phase: string; chars?: number } | null

export function AdminContent() {
  const [code, setCode] = useState<string | null>(null)
  const [books, setBooks] = useState<Book[] | null>(null)
  const [ready, setReady] = useState<PackInfo[]>([])
  const [error, setError] = useState('')
  const [job, setJob] = useState<Job>(null)
  const [log, setLog] = useState<string[]>([])
  const ctrl = useRef<AbortController | null>(null)

  const loadIndex = () => api<{ lessons: PackInfo[] }>('/lessons').then((r) => setReady(r.lessons))
  useEffect(() => {
    void (async () => {
      try {
        const c = await serverLibraryCode()
        if (!c) return setError('رمز المكتبة غير مُعدّ في الخادم (LIBRARY_CODE)، فلا يمكن قراءة الكتب.')
        setCode(c)
        const [items, cat] = await Promise.all([openLibrary(c), lessonCatalog(c)])
        const list = items.map((item) => ({ item, lessons: lessonsOf((cat.find((x) => x.id === item.id)?.sections ?? []) as Section[]) }))
        list.sort((a, b) => (ORDER.indexOf(a.item.subject) + 99) % 99 - (ORDER.indexOf(b.item.subject) + 99) % 99 || a.item.title.localeCompare(b.item.title, 'ar'))
        setBooks(list)
        await loadIndex()
      } catch {
        setError('تعذّر فتح المكتبة أو الاتصال بالخادم.')
      }
    })()
    return () => ctrl.current?.abort()
  }, [])

  const info = (b: string, s: string) => ready.find((r) => r.bookId === b && r.sectionId === s)
  const complete = (i?: PackInfo) => !!i && CORE.every((p) => i.parts.includes(p))
  const say = (t: string) => setLog((l) => [`${new Date().toLocaleTimeString('ar')}: ${t}`, ...l].slice(0, 60))

  /** يجهّز دروس الكتب المعطاة واحداً تلو الآخر حتى يكتمل أو تنفد الحصة أو يُوقف */
  const run = async (targets: { book: Book; lessons: Section[] }[]) => {
    if (!code || job) return
    const c = (ctrl.current = new AbortController())
    await refresh()
    await docsReady
    let done = 0
    let failed = 0
    try {
      for (const t of targets) {
        if (!t.lessons.length) continue
        const id = t.book.item.id
        // ملف الكتاب يلزم لرسم صور الصفحات: يُنزَّل إلى هذا الجهاز مرة واحدة
        if (!getDocs()[id]?.chunkCount || !(await hasPdf(id))) {
          setJob({ bookId: id, sectionId: '', phase: `ينزّل «${t.book.item.title}» إلى هذا الجهاز` })
          await downloadBook(code, t.book.item, () => {})
        }
        const doc = getDocs()[id]
        // ثلاثة دروس معاً من الكتاب نفسه (ضمن حد الطلبات في الدقيقة)، والكتب واحداً بعد الآخر
        const queue = [...t.lessons]
        let stop = false
        const worker = async () => {
          for (let s = queue.shift(); s && !stop && !c.signal.aborted; s = queue.shift()) {
            const sec = s
            setJob({ bookId: id, sectionId: sec.id, phase: 'يبدأ' })
            try {
              const { pack, dropped } = await prepareLesson({ bookId: id, bookTitle: t.book.item.title, subject: t.book.item.subject, section: sec }, doc, c.signal, (p) => setJob({ bookId: id, sectionId: sec.id, ...p }))
              await uploadPack(pack)
              done++
              failed = 0
              say(`«${sec.title}» (${t.book.item.title}): ${num(pack.steps.length)} خطوات، ${num(pack.quiz.length)} سؤالاً، ${num(pack.cards.length)} بطاقة${dropped ? `، حُذف ${num(dropped)} بنداً لم يثبت في الكتاب` : ''}`)
              await loadIndex()
            } catch (e) {
              if (c.signal.aborted) return
              if (e instanceof Unavailable) {
                if (!stop) say('توقف التجهيز: نفدت الحصة المجانية أو الخدمة غير متاحة الآن. أكمل لاحقاً من حيث توقف.')
                stop = true
                return
              }
              failed++
              say(`تعذّر تجهيز «${sec.title}» (${t.book.item.title}). سيُعاد في المرة القادمة.`)
              if (failed >= 4) {
                if (!stop) say('توقف التجهيز بعد أربع محاولات فاشلة متتالية.')
                stop = true
              }
            }
          }
        }
        await Promise.all([worker(), worker(), worker()])
        if (stop || c.signal.aborted) return
      }
    } catch {
      say('تعذّر تنزيل الكتاب إلى هذا الجهاز.')
    } finally {
      setJob(null)
      ctrl.current = null
      if (done) toast(`جُهّز ${num(done)} درساً.`)
    }
  }
  const missing = (b: Book) => b.lessons.filter((s) => !complete(info(b.item.id, s.id)))
  const status = async (b: string, s: string, st: 'ai' | 'reviewed' | 'hidden') => {
    await setPackStatus(b, s, st).catch(() => toast('تعذّر الحفظ.'))
    await loadIndex()
  }

  if (error) return <div className="page"><p className="warn">{error}</p></div>
  if (!books) return <div className="page"><p className="thinking"><LoaderCircle className="spin" aria-hidden="true" /> يفتح المكتبة…</p></div>
  const total = books.reduce((n, b) => n + b.lessons.length, 0)
  const readyN = books.reduce((n, b) => n + b.lessons.filter((s) => complete(info(b.item.id, s.id))).length, 0)
  const reviewed = ready.filter((r) => r.status === 'reviewed').length

  return (
    <div className="page">
      <Link to="/admin" className="text-link back-link">لوحة المتابعة</Link>
      <header className="page-head">
        <div>
          <h1>جاهزية المحتوى</h1>
          <p className="muted">شرح وملخصات وبطاقات واختبارات لكل درس، تُجهَّز مرة واحدة ويقرؤها الطالبان فوراً دون استهلاك الحصة.</p>
        </div>
      </header>
      <section className="panel content-sum">
        <div className="stat-row">
          <div><strong>{num(readyN)}</strong><small>من {num(total)} درساً جاهز</small></div>
          <div><strong>{num(Math.round((readyN / Math.max(1, total)) * 100))}٪</strong><small>نسبة الجاهزية</small></div>
          <div><strong>{num(reviewed)}</strong><small>راجعه المسؤول</small></div>
        </div>
        <div className="meter" aria-hidden="true"><span style={{ width: `${(readyN / Math.max(1, total)) * 100}%` }} /></div>
        <p className="hint">المحتوى من إعداد Gemini من صفحات الكتاب (النص وصور الصفحات)، ويُحذف آلياً كل بند لا يرتبط بمقطع من الدرس. يظهر للطالب موسوماً بأنه لم يراجعه معلم حتى تعلّمه «راجعته». الصفحة يجب أن تبقى مفتوحة أثناء التجهيز.</p>
        <div className="btn-row">
          {job ? (
            <button className="btn" onClick={() => ctrl.current?.abort()}><Square aria-hidden="true" /> إيقاف</button>
          ) : (
            <button className="btn btn-primary" disabled={readyN === total} onClick={() => void run(books.map((b) => ({ book: b, lessons: missing(b) })))}>
              <Play aria-hidden="true" /> جهّز كل الناقص ({num(total - readyN)})
            </button>
          )}
        </div>
        {job && (
          <p className="thinking">
            <LoaderCircle className="spin" aria-hidden="true" /> {books.find((b) => b.item.id === job.bookId)?.lessons.find((s) => s.id === job.sectionId)?.title ?? ''} — {job.phase}
            {job.chars ? ` (${num(job.chars)} حرفاً)` : ''}
          </p>
        )}
        {log.length > 0 && (
          <details className="prep-log" open>
            <summary>سجل التجهيز</summary>
            <ul>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </details>
        )}
      </section>

      {books.map((b) => {
        const done = b.lessons.filter((s) => complete(info(b.item.id, s.id))).length
        const left = missing(b)
        return (
          <details key={b.item.id} className="panel content-book">
            <summary>
              <span className="grow">
                <strong>{b.item.title}</strong>
                <small className="muted"> {b.item.subject}</small>
              </span>
              <span className="count" data-full={done === b.lessons.length}>{num(done)} / {num(b.lessons.length)}</span>
            </summary>
            <div className="btn-row">
              <button className="btn btn-sm" disabled={!!job || !left.length} onClick={() => void run([{ book: b, lessons: left }])}>
                <Play aria-hidden="true" /> جهّز الناقص في هذا الكتاب ({num(left.length)})
              </button>
            </div>
            <ul className="admin-list content-lessons">
              {b.lessons.map((s) => {
                const i = info(b.item.id, s.id)
                const busy = job?.sectionId === s.id
                const lacks = i ? Object.keys(PART_LABEL).filter((p) => !i.parts.includes(p)) : []
                return (
                  <li key={s.id} data-state={busy ? 'busy' : !i ? 'none' : i.status === 'hidden' ? 'hidden' : complete(i) ? 'ok' : 'part'}>
                    <span className="grow">
                      <strong>{s.title}</strong>
                      <small className="muted">
                        ص {num(s.page)}–{num(s.endPage)}
                        {i ? `، جُهّز ${ago(i.updated)}` : '، لم يُجهَّز'}
                        {i?.status === 'reviewed' ? '، راجعه المسؤول' : i?.status === 'hidden' ? '، مخفي عن الطالبين' : ''}
                        {lacks.length && i ? `، ينقصه: ${lacks.map((p) => PART_LABEL[p]).join('، ')}` : ''}
                      </small>
                    </span>
                    {busy ? <LoaderCircle className="spin" aria-label="يُجهَّز الآن" /> : i ? complete(i) ? <CircleCheck aria-label="جاهز" /> : <TriangleAlert aria-label="ناقص" /> : null}
                    <button className="icon-btn" disabled={!!job} onClick={() => void run([{ book: b, lessons: [s] }])} aria-label={i ? `أعد تجهيز «${s.title}»` : `جهّز «${s.title}»`} title={i ? 'أعد التجهيز' : 'جهّز'}>
                      {i ? <RefreshCw /> : <Play />}
                    </button>
                    {i && (
                      <>
                        <button className="icon-btn" aria-pressed={i.status === 'reviewed'} onClick={() => void status(b.item.id, s.id, i.status === 'reviewed' ? 'ai' : 'reviewed')} title="راجعته" aria-label={`راجعت «${s.title}»`}>
                          <CircleCheck />
                        </button>
                        <button className="icon-btn" aria-pressed={i.status === 'hidden'} onClick={() => void status(b.item.id, s.id, i.status === 'hidden' ? 'ai' : 'hidden')} title="إخفاء عن الطالبين" aria-label={`إخفاء «${s.title}»`}>
                          <EyeOff />
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
    </div>
  )
}
