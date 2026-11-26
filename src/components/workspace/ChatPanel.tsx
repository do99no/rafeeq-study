import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookPlus, Copy, MessageCircleQuestion, NotebookPen, RotateCcw, Square, Volume2, VolumeX } from 'lucide-react'
import { useDocs } from '../../services/books/process'
import { answer, FOLLOW_UPS, type FollowUp } from '../../services/study/assistant'
import { actions, getState, uid, useData } from '../../store/store'
import { toast } from '../../store/toast'
import type { Book, Message, Notebook } from '../../types'
import { RichText } from '../RichText'
import { ScopePicker, toScope } from '../ScopePicker'

const NONE: Message[] = []
const plain = (t: string) => t.replace(/\*\*|`|\s?\[\d+\]/g, '')
const canSpeak = 'speechSynthesis' in window

interface Props {
  notebook: Notebook
  books: Book[]
  activeIds: string[]
  onAddSource: () => void
}

export function ChatPanel({ notebook, books, activeIds, onAddSource }: Props) {
  const messages = useData().messages[notebook.id] ?? NONE
  const docs = useDocs()
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [scope, setScope] = useState('all')
  const [speaking, setSpeaking] = useState<string | null>(null)
  const ctrl = useRef<AbortController>(null)
  const unmounted = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

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

  const ask = async (question: string, history: Message[], followUp: boolean) => {
    const c = (ctrl.current = new AbortController())
    const profileId = getState().activeId
    let text = ''
    setStreaming('')
    try {
      for await (const ev of answer({ question, history, scope: toScope(scope, activeIds, docs), followUp, signal: c.signal })) {
        if (unmounted.current || getState().activeId !== profileId) return
        if (ev.type === 'text') setStreaming((text += ev.text))
        else if (ev.type === 'reset') setStreaming((text = ''))
        else actions.addMessage(notebook.id, { id: uid(), role: 'assistant', createdAt: Date.now(), ...ev.message })
      }
    } catch {
      if (!c.signal.aborted) toast('تعذّر الحصول على إجابة. حاول مرة أخرى.')
    }
    if (!unmounted.current) setStreaming(null)
  }

  const send = (raw: string, followUp = false) => {
    const question = raw.trim()
    if (!question || streaming !== null || !activeIds.length) return
    pinned.current = true
    const history = messages
    actions.addMessage(notebook.id, { id: uid(), role: 'user', text: question, createdAt: Date.now() })
    if (!followUp) setDraft('')
    void ask(question, history, followUp)
  }

  const copy = (m: Message) =>
    navigator.clipboard.writeText(plain(m.text)).then(
      () => toast('تم نسخ الإجابة.'),
      () => toast('تعذّر النسخ من هذا المتصفح.'),
    )
  const saveNote = (m: Message) => {
    const q = messages[messages.indexOf(m) - 1]?.text ?? 'إجابة محفوظة'
    actions.addOutput({ id: uid(), notebookId: notebook.id, title: `ملاحظة: ${q.slice(0, 60)}`, createdAt: Date.now(), data: { kind: 'note', text: m.text, citations: m.citations ?? [] } })
    toast('حُفظت الإجابة في ملاحظاتك.')
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

  const last = messages.at(-1)
  return (
    <section className="chat" aria-label="المحادثة">
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
                {activeIds.length ? <MessageCircleQuestion /> : <BookPlus />}
              </span>
              <h2>{activeIds.length ? 'اسأل عن أي فكرة في مصادرك' : books.length ? 'كتبك قيد التجهيز' : 'أضف مصدراً لتبدأ'}</h2>
              <p className="muted">
                {activeIds.length ? 'كل إجابة تأتي مع الصفحة التي أُخذت منها.' : books.length ? 'حدّد مصدراً مكتملاً، أو تابع حالة المعالجة في المكتبة.' : 'يجيب رفيق من الكتب التي تضيفها إلى هذا الدفتر.'}
              </p>
              {!books.length && (
                <button className="btn btn-primary" onClick={onAddSource}>
                  إضافة مصدر
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
              <div key={m.id} className="msg msg-ai">
                <RichText text={m.text} citations={m.citations} />
                {m.mode === 'ai' && !m.citations?.length && <p className="warn">لا تستند هذه الإجابة إلى استشهاد من كتبك، فتحقق منها قبل الاعتماد عليها.</p>}
                <div className="msg-actions">
                  <button className="icon-btn" onClick={() => void copy(m)} aria-label="نسخ الإجابة" title="نسخ">
                    <Copy />
                  </button>
                  <button className="icon-btn" onClick={() => saveNote(m)} aria-label="حفظ في الملاحظات" title="حفظ في الملاحظات">
                    <NotebookPen />
                  </button>
                  {canSpeak && (
                    <button className="icon-btn" onClick={() => speak(m)} aria-label={speaking === m.id ? 'إيقاف القراءة' : 'قراءة الإجابة صوتياً'} title="قراءة صوتية">
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
              {streaming ? <RichText text={streaming.replace(/\s?[[【][\d٠-٩,،\s]*[\]】]?/g, '')} /> : <p className="thinking">يبحث في مصادرك…</p>}
            </div>
          )}
          {streaming === null && last?.mode === 'ai' && activeIds.length > 0 && (
            <div className="chips">
              {(Object.keys(FOLLOW_UPS) as FollowUp[]).map((f) => (
                <button key={f} className="chip" onClick={() => send(FOLLOW_UPS[f].ask, true)}>
                  {FOLLOW_UPS[f].label}
                </button>
              ))}
            </div>
          )}
          {streaming === null && last?.role === 'user' && activeIds.length > 0 && (
            <button className="btn" onClick={() => void ask(last.text, messages.slice(0, -1), Object.values(FOLLOW_UPS).some((f) => f.ask === last.text))}>
              <RotateCcw aria-hidden="true" /> أعد المحاولة
            </button>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {activeIds.length > 0 && <ScopePicker books={books.filter((b) => activeIds.includes(b.id))} value={scope} onChange={setScope} label="نطاق السؤال" />}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <textarea
            rows={1}
            value={draft}
            maxLength={2000}
            disabled={!activeIds.length}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder={activeIds.length ? 'اكتب سؤالك' : 'حدّد مصدراً جاهزاً أولاً'}
            aria-label="سؤالك"
          />
          {streaming !== null ? (
            <button type="button" className="send" onClick={() => ctrl.current?.abort()} aria-label="إيقاف الإجابة">
              <Square />
            </button>
          ) : (
            <button className="send" disabled={!draft.trim() || !activeIds.length} aria-label="إرسال السؤال">
              <ArrowUp />
            </button>
          )}
        </form>
        <p className="composer-note">راجع الصفحة الأصلية قبل الاعتماد على أي إجابة.</p>
      </div>
    </section>
  )
}
