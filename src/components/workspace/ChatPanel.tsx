import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpenCheck, BookPlus, Check, CircleHelp, Copy, GraduationCap, Layers, ListChecks, LoaderCircle, NotebookPen, RotateCcw, Square, Target, Volume2, VolumeX, X } from 'lucide-react'
import { num } from '../../lib/format'
import { onAsk, takeAsk } from '../../lib/study'
import { useDocs } from '../../services/books/process'
import { makeCards, makeQuiz, StudyError } from '../../services/study/generate'
import { looksLikeRequest } from '../../services/study/intent'
import { LEVELS } from '../../services/study/prompts'
import { respond, streamView, type Ask } from '../../services/study/tutor'
import { Unavailable } from '../../services/ai/manager'
import { actions, chatOf, getState, uid, useData } from '../../store/store'
import { toast } from '../../store/toast'
import type { Book, Focus, Level, Message, Notebook, StudyOutput, Task } from '../../types'
import { RichText } from '../RichText'
import { LessonPicker } from './LessonPicker'
import { PagesNote } from './PagesNote'

const NONE: Message[] = []
const plain = (t: string) => t.replace(/\*\*|`|#+ |^> ?/gm, '').replace(/\s?\[\d+\]/g, '')
const canSpeak = 'speechSynthesis' in window

/** الأفعال السريعة على الدرس المختار */
const LESSON_ACTIONS: { label: string; text: string; task: Task; icon: typeof Target }[] = [
  { label: 'اشرح الدرس كاملاً', text: 'اشرح لي هذا الدرس من البداية', task: 'explain', icon: BookOpenCheck },
  { label: 'علّمني خطوة بخطوة', text: 'علّمني هذا الدرس خطوة بخطوة', task: 'teach', icon: GraduationCap },
  { label: 'اختبرني', text: 'اختبرني في هذا الدرس', task: 'check', icon: CircleHelp },
  { label: 'لخّصه', text: 'لخّص لي هذا الدرس', task: 'summary', icon: NotebookPen },
  { label: 'ما أهم ما أحفظه؟', text: 'ما أهم الأشياء التي يجب أن أحفظها في هذا الدرس؟', task: 'points', icon: Target },
  { label: 'أخطاء شائعة', text: 'ما الأخطاء التي قد أقع فيها في الامتحان في هذا الدرس؟', task: 'mistakes', icon: X },
]
const EXAMPLES = ['اشرح لي الفرق بين مفهومين في الدرس', 'أعطني أمثلة على هذه القاعدة', 'اشرح لي هذه المعادلة خطوة بخطوة']
const VERDICT: Record<string, string> = { correct: 'إجابة صحيحة', partial: 'إجابة صحيحة جزئياً', wrong: 'إجابة غير صحيحة', skipped: 'تُخطي السؤال' }

interface Props {
  notebook: Notebook
  books: Book[]
  activeIds: string[]
  onAddSource: () => void
  onOpenOutput: (o: StudyOutput) => void
}

export function ChatPanel({ notebook, books, activeIds, onAddSource, onOpenOutput }: Props) {
  const data = useData()
  const chatId = chatOf(notebook)
  const messages = data.messages[chatId] ?? NONE
  const level = data.settings.level
  const docs = useDocs()
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')
  const [picking, setPicking] = useState(false)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const ctrl = useRef<AbortController>(null)
  const unmounted = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  const focus = notebook.focus && activeIds.includes(notebook.focus.bookId) ? notebook.focus : undefined
  const openCheck = messages.findLast((m) => m.role === 'assistant' && m.check && !m.check.closed)
  const last = messages.at(-1)

  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      ctrl.current?.abort()
      if (canSpeak) speechSynthesis.cancel()
    }
  }, [])

  // يتابع آخر الرسائل ما لم يصعد الطالب للقراءة
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const titleOf = (id: string) => data.books.find((b) => b.id === id)?.title ?? ''
  const subjectOf = (id: string) => data.books.find((b) => b.id === id)?.subject

  const ask = async (a: Ask, history: Message[]) => {
    const c = (ctrl.current = new AbortController())
    const profileId = getState().activeId
    const nb = getState().data.notebooks.find((n) => n.id === notebook.id) ?? notebook
    let f = nb.focus && activeIds.includes(nb.focus.bookId) ? nb.focus : undefined
    let text = ''
    setStreaming('')
    setStatus('')
    try {
      for await (const ev of respond(a, history, { bookIds: activeIds, focus: f, docs, level: getState().data.settings.level, titleOf, subjectOf }, c.signal)) {
        if (unmounted.current || getState().activeId !== profileId) return
        if (ev.type === 'text') setStreaming((text += ev.text))
        else if (ev.type === 'reset') setStreaming((text = ''))
        else if (ev.type === 'status') setStatus(ev.text)
        else if (ev.type === 'focus') {
          f = ev.focus
          actions.setFocus(notebook.id, ev.focus)
        } else {
          const m = ev.message
          actions.addMessage(chatId, { id: uid(), role: 'assistant', createdAt: Date.now(), ...m })
          if (m.mode === 'ai' && f) {
            const base = { bookId: f.bookId, title: f.title, from: f.from, to: f.to, notebookId: notebook.id }
            if (m.task === 'explain') actions.recordStudy({ ...base, explained: Date.now() })
            if (m.task === 'teach' && m.part) actions.recordStudy({ ...base, taught: m.part })
          }
          if (m.task === 'grade' && m.verdict && a.grade) settle(a.grade, m.verdict, a.text)
        }
      }
    } catch {
      if (!c.signal.aborted) toast('تعذّر الحصول على رد. حاول مرة أخرى.')
    }
    if (!unmounted.current) {
      setStreaming(null)
      setStatus('')
    }
  }

  /** يسجل نتيجة سؤال الفهم: تقدم الدرس، والخطأ ليُراجع لاحقاً */
  const settle = (check: Message, verdict: string, given: string) => {
    const nb = getState().data.notebooks.find((n) => n.id === notebook.id)
    const f = nb?.focus
    const c = check.check!
    const right = verdict === 'correct'
    if (f) actions.recordStudy({ bookId: f.bookId, title: f.title, from: f.from, to: f.to, notebookId: notebook.id, checks: { right: right ? 1 : 0, total: 1 } })
    if (!right && c.cite)
      actions.addMistakes([{ bookId: c.cite.bookId, bookTitle: c.cite.bookTitle, page: c.cite.page, topic: f?.title ?? c.cite.section ?? c.cite.bookTitle, q: c.q, answer: c.answer, given, source: 'chat', notebookId: notebook.id }])
  }

  const send = (a: Ask & { quote?: string }) => {
    const text = a.text.trim()
    if (!text || streaming !== null || !activeIds.length) return
    pinned.current = true
    let history = messages
    // إجابة عن سؤال الفهم المفتوح، ما لم يكن طلباً جديداً
    let grade: Message | undefined
    if (openCheck && !a.task && !a.basis) {
      actions.updateMessage(chatId, openCheck.id, { check: { ...openCheck.check!, closed: true } })
      if (!looksLikeRequest(text)) grade = openCheck
      history = getState().data.messages[chatId] ?? messages
    }
    actions.addMessage(chatId, { id: uid(), role: 'user', text: a.quote ? `${text}\n«${a.quote.slice(0, 240)}${a.quote.length > 240 ? '…' : ''}»` : text, createdAt: Date.now() })
    setDraft('')
    void ask({ ...a, text, grade }, history)
  }

  // طلب من القارئ أو الرئيسية أو صفحة التقدم
  useEffect(() => {
    const run = () => {
      if (!activeIds.length) return
      const a = takeAsk(notebook.id)
      if (a) send(a)
    }
    run()
    return onAsk(run)
  })

  const skip = (m: Message) => {
    actions.updateMessage(chatId, m.id, { check: { ...m.check!, closed: true }, verdict: 'skipped' })
    send({ text: 'لا أعرف الإجابة، اشرحها لي', task: 'answer', basis: m.basis?.slice(0, 3) })
  }
  const selfGrade = (m: Message, right: boolean) => {
    const check = messages.slice(0, messages.indexOf(m)).findLast((x) => x.check)
    actions.updateMessage(chatId, m.id, { verdict: right ? 'correct' : 'wrong' })
    if (check) settle(check, right ? 'correct' : 'wrong', messages[messages.indexOf(m) - 1]?.text ?? '')
  }

  /** اختبار أو بطاقات من الدرس الحالي تُحفظ في المراجعة */
  const make = async (kind: 'quiz' | 'cards') => {
    if (!focus) return setPicking(true)
    const c = (ctrl.current = new AbortController())
    setBusy(kind === 'quiz' ? 'يُعدّ اختباراً من الدرس…' : 'يُعدّ بطاقات من الدرس…')
    try {
      const scope = { bookIds: [focus.bookId], pages: { bookId: focus.bookId, from: focus.from, to: focus.to } }
      const data = kind === 'quiz' ? await makeQuiz(scope, ['mcq', 'tf', 'fill', 'short', 'reason'], 8, c.signal) : await makeCards(scope, 'all', 12, c.signal)
      const o: StudyOutput = { id: uid(), notebookId: notebook.id, title: `${kind === 'quiz' ? 'اختبار' : 'بطاقات'}: ${focus.title}`, createdAt: Date.now(), data }
      actions.addOutput(o)
      onOpenOutput(o)
    } catch (e) {
      if (!c.signal.aborted) toast(e instanceof StudyError ? e.message : e instanceof Unavailable ? 'الإنشاء يحتاج إلى خدمة الذكاء الاصطناعي، وهي غير متاحة الآن.' : 'تعذّر الإنشاء. حاول مرة أخرى.')
    }
    if (!unmounted.current) setBusy('')
  }

  const copy = (m: Message) =>
    navigator.clipboard.writeText(plain(m.text)).then(
      () => toast('تم النسخ.'),
      () => toast('تعذّر النسخ من هذا المتصفح.'),
    )
  const save = (m: Message) => {
    const q = messages[messages.indexOf(m) - 1]?.text ?? 'رد محفوظ'
    const asSummary = m.task === 'summary' || m.task === 'points' || m.task === 'mistakes' || m.task === 'explain'
    const name = focus?.title ?? q.slice(0, 60)
    const title = m.task === 'summary' ? `ملخص: ${name}` : m.task === 'points' ? `نقاط الحفظ: ${name}` : m.task === 'mistakes' ? `أخطاء شائعة: ${name}` : m.task === 'explain' ? `شرح: ${name}${m.part && m.part.n > 1 ? ` (${num(m.part.k)} من ${num(m.part.n)})` : ''}` : `ملاحظة: ${q.slice(0, 60)}`
    const o: StudyOutput = { id: uid(), notebookId: notebook.id, title, createdAt: Date.now(), data: { kind: asSummary ? 'summary' : 'note', text: m.text, citations: m.citations ?? [] } }
    actions.addOutput(o)
    actions.updateMessage(chatId, m.id, { savedAs: o.id })
    toast('حُفظ في المراجعة.')
  }
  const speak = (m: Message) => {
    speechSynthesis.cancel()
    if (speaking === m.id) return setSpeaking(null)
    const u = new SpeechSynthesisUtterance(plain(m.text))
    u.lang = 'ar'
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ar')) ?? null
    u.onend = u.onerror = () => setSpeaking(null)
    setSpeaking(m.id)
    speechSynthesis.speak(u)
  }

  /** الخطوة التعليمية التالية حسب آخر رد */
  const next = (m: Message): { label: string; ask: Ask }[] => {
    if (m.check && !m.check.closed) return []
    const tutorPart = messages.findLast((x) => x.task === 'teach' && x.part)?.part
    if (m.task === 'grade') {
      const ok = m.verdict === 'correct'
      const out: { label: string; ask: Ask }[] = []
      if (!ok) out.push({ label: 'اشرحها بطريقة أخرى', ask: { text: 'لم أفهمها، اشرحها لي بطريقة أخرى أبسط', task: 'answer' } })
      if (tutorPart && tutorPart.k < tutorPart.n) out.push({ label: ok ? `الفكرة التالية (${num(tutorPart.k + 1)} من ${num(tutorPart.n)})` : 'تابع إلى الفكرة التالية', ask: { text: 'انتقل إلى الفكرة التالية', task: 'teach', part: tutorPart.k + 1 } })
      out.push({ label: ok ? 'سؤال آخر' : 'سؤال آخر عن الفكرة نفسها', ask: { text: 'اختبرني بسؤال آخر', task: 'check', basis: ok ? undefined : m.basis?.slice(0, 3) } })
      return out
    }
    if (m.task === 'explain' && m.part && m.part.k < m.part.n)
      return [
        { label: `تابع الشرح (${num(m.part.k + 1)} من ${num(m.part.n)})`, ask: { text: 'تابع شرح الدرس', task: 'explain', part: m.part.k + 1 } },
        { label: 'اختبرني في هذا الجزء', ask: { text: 'اختبرني في هذا الجزء', task: 'check', basis: m.basis?.slice(0, 4) } },
        { label: 'بسّط أكثر', ask: { text: 'لم أفهم، بسّط هذا الجزء أكثر', task: 'answer' } },
      ]
    if (m.mode !== 'ai') return []
    return [
      { label: 'بسّط أكثر', ask: { text: 'لم أفهم، بسّط الشرح أكثر', task: 'answer' } },
      { label: 'أعطني مثالاً', ask: { text: 'أعطني مثالاً تطبيقياً', task: 'examples' } },
      { label: 'اشرح خطوة بخطوة', ask: { text: 'اشرحها خطوة بخطوة', task: 'steps' } },
      { label: 'اختبرني', ask: { text: 'اختبرني فيما شرحته', task: 'check', basis: m.basis?.slice(0, 4) } },
    ]
  }

  const ready = activeIds.length > 0
  const idle = streaming === null && !busy
  return (
    <section className="chat" aria-label="المحادثة">
      {ready && (
        <div className="study-bar">
          <button className="focus-btn" onClick={() => setPicking(true)} aria-label={focus ? `الدرس الحالي: ${focus.title}. تغيير الدرس` : 'اختر الدرس'}>
            <Target aria-hidden="true" />
            <span className="grow">
              <small>أدرس الآن</small>
              <strong>{focus ? focus.title : 'اختر درساً'}</strong>
            </span>
            <span className="focus-change">{focus ? 'تغيير' : 'اختيار'}</span>
          </button>
          {focus && (
            <button className="icon-btn" onClick={() => actions.setFocus(notebook.id, undefined)} aria-label="الدراسة من كل المصادر" title="كل المصادر">
              <X />
            </button>
          )}
          <select className="level-select" value={level} onChange={(e) => actions.setSettings({ level: e.target.value as Level })} aria-label="مستوى الشرح">
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <option key={l} value={l}>
                {LEVELS[l].label}
              </option>
            ))}
          </select>
          <div className="segmented level" role="group" aria-label="مستوى الشرح">
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <button key={l} aria-pressed={level === l} title={LEVELS[l].hint} onClick={() => actions.setSettings({ level: l })}>
                {LEVELS[l].label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="chat-scroll"
        ref={scroller}
        tabIndex={0}
        role="log"
        aria-label="الرسائل"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <div className="chat-col">
          {messages.length === 0 && (
            <div className="chat-empty">
              <span className="empty-mark" aria-hidden="true">
                {ready ? <GraduationCap /> : <BookPlus />}
              </span>
              <h2>{!ready ? (books.length ? 'كتبك قيد التجهيز' : 'أضف كتاباً لتبدأ') : focus ? focus.title : 'ماذا ندرس اليوم؟'}</h2>
              <p className="muted">
                {!ready
                  ? books.length ? 'حدّد مصدراً مكتملاً، أو تابع حالة المعالجة في المكتبة.' : 'يشرح رفيق من الكتب التي تضيفها إلى هذا الدفتر.'
                  : focus ? 'اختر كيف تريد أن تدرس هذا الدرس، أو اكتب طلبك بكلماتك.' : 'اختر الدرس الذي تذاكره، ثم اطلب شرحه أو اختبارك فيه. ويمكنك أيضاً أن تسأل مباشرة.'}
              </p>
              {!books.length && (
                <button className="btn btn-primary" onClick={onAddSource}>
                  إضافة كتاب
                </button>
              )}
              {ready && !focus && (
                <button className="btn btn-primary" onClick={() => setPicking(true)}>
                  <Target aria-hidden="true" /> اختر الدرس
                </button>
              )}
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="msg msg-ai" data-task={m.task}>
                {m.part && m.part.n > 1 && (
                  <p className="part-tag">
                    {m.task === 'teach' ? 'الخطوة' : 'الجزء'} {num(m.part.k)} من {num(m.part.n)}
                  </p>
                )}
                {m.verdict && m.verdict !== 'skipped' && (
                  <p className="verdict" data-v={m.verdict}>
                    {m.verdict === 'correct' ? <Check aria-hidden="true" /> : <X aria-hidden="true" />} {VERDICT[m.verdict]}
                  </p>
                )}
                <RichText text={m.text} citations={m.citations} />
                {m.check && (
                  <div className="check-card" data-closed={!!m.check.closed}>
                    <p className="check-label">
                      <CircleHelp aria-hidden="true" /> سؤال للتأكد من فهمك
                    </p>
                    <p className="check-q">{m.check.q}</p>
                    {!m.check.closed ? (
                      <div className="btn-row">
                        <button className="btn btn-sm btn-primary" onClick={() => input.current?.focus()}>
                          اكتب إجابتك
                        </button>
                        <button className="btn btn-sm" disabled={!idle} onClick={() => skip(m)}>
                          لا أعرف، اشرحها لي
                        </button>
                      </div>
                    ) : (
                      m.verdict === 'skipped' && <p className="muted">الإجابة: {m.check.answer}</p>
                    )}
                  </div>
                )}
                {m.task === 'grade' && m.mode === 'search' && !m.verdict && (
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => selfGrade(m, true)}>
                      <Check aria-hidden="true" /> أصبت
                    </button>
                    <button className="btn btn-sm" onClick={() => selfGrade(m, false)}>
                      <X aria-hidden="true" /> أخطأت
                    </button>
                  </div>
                )}
                {m.pages && <PagesNote pages={m.pages} />}
                {m.mode === 'ai' && !m.citations?.length && m.task !== 'grade' && <p className="warn">لا يستند هذا الرد إلى استشهاد من كتبك، فتحقق منه قبل الاعتماد عليه.</p>}
                <div className="msg-actions">
                  <button className="icon-btn" onClick={() => void copy(m)} aria-label="نسخ" title="نسخ">
                    <Copy />
                  </button>
                  {m.mode === 'ai' && m.task !== 'grade' && (
                    <button className="icon-btn" onClick={() => save(m)} disabled={!!m.savedAs} aria-label={m.savedAs ? 'محفوظ في المراجعة' : 'حفظ في المراجعة'} title={m.savedAs ? 'محفوظ' : 'حفظ في المراجعة'}>
                      {m.savedAs ? <Check /> : <NotebookPen />}
                    </button>
                  )}
                  {canSpeak && (
                    <button className="icon-btn" onClick={() => speak(m)} aria-label={speaking === m.id ? 'إيقاف القراءة' : 'قراءة صوتية'} title="قراءة صوتية">
                      {speaking === m.id ? <VolumeX /> : <Volume2 />}
                    </button>
                  )}
                  {m.provider && <small className="muted">{m.provider}</small>}
                </div>
              </div>
            ),
          )}
          {streaming !== null && (
            <div className="msg msg-ai" aria-live="off">
              {streaming ? <RichText text={streamView(streaming)} /> : <p className="thinking">{status || 'يقرأ الدرس من كتابك…'}</p>}
            </div>
          )}
          {busy && (
            <p className="thinking">
              <LoaderCircle className="spin" aria-hidden="true" /> {busy}
            </p>
          )}
          {idle && last?.role === 'assistant' && ready && (
            <div className="chips next-steps">
              {next(last).map((n) => (
                <button key={n.label} className="chip" onClick={() => send(n.ask)}>
                  {n.label}
                </button>
              ))}
              {focus && last.task === 'grade' && (() => {
                const p = messages.findLast((x) => x.task === 'teach' && x.part)?.part
                return p && p.k >= p.n
              })() && (
                <button className="chip chip-strong" onClick={() => void make('quiz')}>
                  <ListChecks aria-hidden="true" /> اختبار قصير في نهاية الدرس
                </button>
              )}
              {focus && (last.task === 'summary' || last.task === 'points') && (
                <button className="chip" onClick={() => void make('cards')}>
                  <Layers aria-hidden="true" /> بطاقات من هذا الدرس
                </button>
              )}
            </div>
          )}
          {idle && last?.role === 'user' && ready && (
            <button className="btn" onClick={() => void ask({ text: last.text.split('\n«')[0] }, messages.slice(0, -1))}>
              <RotateCcw aria-hidden="true" /> أعد المحاولة
            </button>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {ready && idle && focus && !openCheck && (
          <div className="lesson-actions" role="group" aria-label="ادرس هذا الدرس">
            {LESSON_ACTIONS.map((a) => (
              <button key={a.task} className="chip" onClick={() => send({ text: a.text, task: a.task })}>
                <a.icon aria-hidden="true" /> {a.label}
              </button>
            ))}
            <button className="chip" onClick={() => void make('quiz')}>
              <ListChecks aria-hidden="true" /> اختبار كامل
            </button>
            <button className="chip" onClick={() => void make('cards')}>
              <Layers aria-hidden="true" /> بطاقات
            </button>
          </div>
        )}
        {ready && idle && !focus && messages.length === 0 && (
          <div className="lesson-actions">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" onClick={() => setDraft(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        <form
          className="composer"
          data-answer={!!openCheck}
          onSubmit={(e) => {
            e.preventDefault()
            send({ text: draft })
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            maxLength={2000}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send({ text: draft })
              }
            }}
            placeholder={!ready ? 'حدّد مصدراً جاهزاً أولاً' : openCheck ? 'اكتب إجابتك عن السؤال' : focus ? 'اطلب شرحاً أو اسأل عن أي فكرة في الدرس' : 'اسأل أو اطلب شرحاً'}
            aria-label={openCheck ? 'إجابتك' : 'طلبك'}
          />
          {streaming !== null || busy ? (
            <button type="button" className="send" onClick={() => ctrl.current?.abort()} aria-label="إيقاف">
              <Square />
            </button>
          ) : (
            <button className="send" disabled={!draft.trim() || !ready} aria-label="إرسال">
              <ArrowUp />
            </button>
          )}
        </form>
        <p className="composer-note">الإجابات مبنية على كتبك؛ راجع الصفحة الأصلية خاصة في المعادلات.</p>
      </div>
      {picking && <LessonPicker books={books.filter((b) => activeIds.includes(b.id))} value={focus} onPick={(f: Focus) => actions.setFocus(notebook.id, f)} onClose={() => setPicking(false)} />}
    </section>
  )
}
