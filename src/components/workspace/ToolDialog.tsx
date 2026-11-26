import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { num } from '../../lib/format'
import { outputMeta } from '../../lib/outputs'
import { Unavailable } from '../../services/ai/manager'
import { useDocs } from '../../services/books/process'
import { CARD_KINDS, makeCards, makeCompare, makeMindmap, makeQuiz, makeSummary, QUESTION_TYPES, StudyError, SUMMARY_STYLES, type CardKind, type SummaryStyle } from '../../services/study/generate'
import { actions, getState, uid } from '../../store/store'
import type { Book, Notebook, OutputData, QuestionType, StudyOutput } from '../../types'
import { Dialog } from '../Dialog'
import { ScopePicker, toScope } from '../ScopePicker'

export type ToolKind = 'summary' | 'quiz' | 'cards' | 'mindmap' | 'compare'

interface Props {
  kind: ToolKind
  notebook: Notebook
  books: Book[]
  onClose: () => void
  onDone: (o: StudyOutput) => void
}

function Choice<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className="chips">
        {options.map(([v, t]) => (
          <button type="button" key={v} className="chip" aria-pressed={v === value} onClick={() => onChange(v)}>
            {t}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export default function ToolDialog({ kind, notebook, books, onClose, onDone }: Props) {
  const docs = useDocs()
  const ids = books.map((b) => b.id)
  const firstSection = books.length === 1 ? docs[books[0].id]?.sections[0] : undefined
  const fo = notebook.focus && ids.includes(notebook.focus.bookId) ? notebook.focus : undefined
  const [scope, setScope] = useState(fo ? (fo.sectionId ? `sec:${fo.bookId}:${fo.sectionId}` : `pages:${fo.bookId}:${fo.from}:${fo.to}`) : firstSection ? `sec:${books[0].id}:${firstSection.id}` : 'all')
  const [multi, setMulti] = useState<string[] | null>(null)
  const [scopeB, setScopeB] = useState('all')
  const [style, setStyle] = useState<SummaryStyle>('full')
  const [types, setTypes] = useState<QuestionType[]>(['mcq', 'tf'])
  const [cardKind, setCardKind] = useState<CardKind>('all')
  const [count, setCount] = useState('10')
  const [topicA, setTopicA] = useState('')
  const [topicB, setTopicB] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const ctrl = useRef<AbortController>(null)
  useEffect(() => () => ctrl.current?.abort(), [])

  const ranges = (multi ?? []).flatMap((k) => {
    const [b, sid] = k.split(':')
    const sec = docs[b]?.sections.find((x) => x.id === sid)
    return sec ? [{ bookId: b, from: sec.page, to: sec.endPage }] : []
  })
  const sc = multi ? { bookIds: ids, ranges } : toScope(scope, ids, docs)
  const scB = toScope(scopeB, ids, docs)
  const ready = multi && !ranges.length ? false : kind === 'quiz' ? types.length > 0 : kind === 'compare' ? (topicA.trim() && topicB.trim()) || (scope !== scopeB && !!(topicA.trim() || scope !== 'all') && !!(topicB.trim() || scopeB !== 'all')) : true

  const run = async () => {
    const c = (ctrl.current = new AbortController())
    const profileId = getState().activeId
    setError('')
    setBusy('يقرأ من كتبك ويتحقق من المصادر…')
    try {
      let data: OutputData
      if (kind === 'summary') data = await makeSummary(sc, style, c.signal, (d, t) => t > 1 && setBusy(`يلخص الجزء ${num(d)} من ${num(t)}…`))
      else if (kind === 'quiz') data = await makeQuiz(sc, types, Number(count), c.signal)
      else if (kind === 'cards') data = await makeCards(sc, cardKind, Number(count), c.signal)
      else if (kind === 'mindmap') data = await makeMindmap(sc, notebook.title, c.signal)
      else data = await makeCompare({ topic: topicA.trim(), scope: sc }, { topic: topicB.trim(), scope: scB }, c.signal)
      if (c.signal.aborted || getState().activeId !== profileId) return
      const sec = multi ? `${num(ranges.length)} دروس` : scope.startsWith('sec:') ? docs[scope.split(':')[1]]?.sections.find((s) => s.id === scope.split(':')[2])?.title : undefined
      const name = kind === 'compare' ? [topicA, topicB].map((t) => t.trim()).filter(Boolean).join(' و') || notebook.title : (sec ?? notebook.title)
      const label = kind === 'summary' ? `ملخص ${SUMMARY_STYLES[style].label}` : outputMeta[kind].label
      const o: StudyOutput = { id: uid(), notebookId: notebook.id, title: `${label}: ${name}`, createdAt: Date.now(), data }
      actions.addOutput(o)
      onDone(o)
    } catch (e) {
      if (c.signal.aborted) return
      setBusy('')
      setError(
        e instanceof StudyError ? e.message
          : e instanceof Unavailable ? (e.reason === 'unset' ? 'لم يُفعَّل الذكاء الاصطناعي بعد. فعّله من الإعدادات.' : 'خدمات الذكاء الاصطناعي غير متاحة مؤقتاً. يمكنك متابعة القراءة والبحث والمراجعة.')
          : 'تعذّر الإنشاء. حاول مرة أخرى.',
      )
    }
  }

  return (
    <Dialog title={outputMeta[kind].label} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && ready) void run()
        }}
      >
        {kind === 'compare' ? (
          <>
            <label className="field">
              <span>الأول</span>
              <input value={topicA} maxLength={100} onChange={(e) => setTopicA(e.target.value)} placeholder="مفهوم أو موضوع، أو اتركه واختر فصلاً" />
            </label>
            <ScopePicker books={books} value={scope} onChange={setScope} label="نطاق الأول" />
            <label className="field">
              <span>الثاني</span>
              <input value={topicB} maxLength={100} onChange={(e) => setTopicB(e.target.value)} placeholder="مفهوم أو موضوع، أو اتركه واختر فصلاً" />
            </label>
            <ScopePicker books={books} value={scopeB} onChange={setScopeB} label="نطاق الثاني" />
          </>
        ) : (
          <div className="field">
            <span>من أين؟</span>
            {!multi && <ScopePicker books={books} value={scope} onChange={setScope} />}
            <button type="button" className="text-link" onClick={() => setMulti(multi ? null : [])}>
              {multi ? 'نطاق واحد' : 'اختر عدة دروس'}
            </button>
            {multi && (
              <div className="multi-lessons">
                {books.map((b) => (
                  <fieldset key={b.id}>
                    <legend>{b.title}</legend>
                    {(docs[b.id]?.sections ?? []).map((x) => {
                      const k = `${b.id}:${x.id}`
                      return (
                        <label key={k} className="check-row" data-level={x.level}>
                          <input type="checkbox" checked={multi.includes(k)} onChange={() => setMulti(multi.includes(k) ? multi.filter((y) => y !== k) : [...multi, k])} />
                          {x.title}
                        </label>
                      )
                    })}
                    {!docs[b.id]?.sections.length && <p className="muted">لا فهرس دروس لهذا الكتاب.</p>}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        )}
        {kind === 'summary' && <Choice legend="نوع الملخص" value={style} onChange={setStyle} options={Object.entries(SUMMARY_STYLES).map(([k, v]) => [k as SummaryStyle, v.label])} />}
        {kind === 'quiz' && (
          <fieldset className="field">
            <legend>أنواع الأسئلة</legend>
            <div className="chips">
              {(Object.keys(QUESTION_TYPES) as QuestionType[]).map((t) => (
                <button type="button" key={t} className="chip" aria-pressed={types.includes(t)} onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}>
                  {QUESTION_TYPES[t]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {kind === 'cards' && <Choice legend="نوع البطاقات" value={cardKind} onChange={setCardKind} options={Object.entries(CARD_KINDS).map(([k, v]) => [k as CardKind, v.label])} />}
        {(kind === 'quiz' || kind === 'cards') && <Choice legend="العدد" value={count} onChange={setCount} options={[['5', num(5)], ['10', num(10)], ['15', num(15)], ['20', num(20)]]} />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-primary" disabled={!!busy || !ready}>
            {busy ? (
              <>
                <LoaderCircle className="spin" aria-hidden="true" /> {busy}
              </>
            ) : (
              'إنشاء'
            )}
          </button>
          {busy && (
            <button type="button" className="btn" onClick={() => { ctrl.current?.abort(); setBusy('') }}>
              إيقاف
            </button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
