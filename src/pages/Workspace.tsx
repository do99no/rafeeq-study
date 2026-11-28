import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { BookMarked, GraduationCap, History, MessageSquarePlus, NotebookPen, Pencil, Trash2, WandSparkles } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { NotebookForm } from '../components/NotebookForm'
import { ChatPanel } from '../components/workspace/ChatPanel'
import { AddSourceDialog } from '../components/workspace/SourcesPanel'
import { LessonTree } from '../components/workspace/LessonTree'
import { LessonStudio, packLabel, packOutput } from '../components/workspace/LessonStudio'
import type { ToolKind } from '../components/workspace/ToolDialog'
import { ago, num } from '../lib/format'
import { useAI } from '../services/ai/manager'
import { isSearchable, useDocs } from '../services/books/process'
import { buildVectors } from '../services/rag/search'
import { Link } from '../router'
import { actions, chatOf, useData } from '../store/store'
import type { StudyOutput } from '../types'
import { syncPacks, type LessonPack, type PackTool } from '../services/study/lessonPack'

const OutputDialog = lazy(() => import('../components/outputs/OutputDialog'))
const ToolDialog = lazy(() => import('../components/workspace/ToolDialog'))

const wide = matchMedia('(min-width: 1180px)')
const useWide = () =>
  useSyncExternalStore(
    (l) => {
      wide.addEventListener('change', l)
      return () => wide.removeEventListener('change', l)
    },
    () => wide.matches,
  )

export default function Workspace({ id }: { id: string }) {
  const data = useData()
  const notebook = data.notebooks.find((n) => n.id === id)
  const docs = useDocs()
  const ai = useAI()
  const isWide = useWide()
  const [off, setOff] = useState<string[]>([])
  const [tab, setTab] = useState<'lessons' | 'chat' | 'studio'>('chat')
  const [dialog, setDialog] = useState<'add' | 'edit' | 'history' | null>(null)
  const [outputId, setOutputId] = useState<string | null>(null)
  /** محتوى جاهز يُعرض دون حفظه في بيانات الطالب */
  const [shown, setShown] = useState<{ output: StudyOutput; prepared: string } | null>(null)
  const [tool, setTool] = useState<ToolKind | null>(null)
  /** أدوات الدرس على الشاشة العريضة: درج يُفتح عند الحاجة ويُغلق عند اختيار أداة (أداة واحدة في كل مرة) */
  const [toolsOpen, setToolsOpen] = useState(false)

  const exists = !!notebook
  useEffect(() => {
    if (exists) actions.touchNotebook(id)
    // محتوى الدروس الجاهز الأحدث من الخادم
    if (exists) void syncPacks()
  }, [id, exists])

  const books = (notebook?.bookIds ?? []).flatMap((b) => data.books.find((x) => x.id === b) ?? [])
  const searchable = books.filter((b) => isSearchable(docs[b.id])).map((b) => b.id)
  const searchKey = searchable.map((s) => `${s}:${docs[s].chunkCount}`).join()
  // الفهرسة الدلالية تجري في الخلفية وتكمل من حيث توقفت
  useEffect(() => {
    if (ai.service.state !== 'ok' || !searchKey) return
    const c = new AbortController()
    void (async () => {
      for (const s of searchKey.split(',')) await buildVectors(s.split(':')[0], c.signal).catch(() => {})
    })()
    return () => c.abort()
  }, [searchKey, ai.service.state])

  if (!notebook)
    return (
      <div className="page">
        <EmptyState icon={NotebookPen} title="هذا الدفتر غير موجود" text="ربما حُذف، أو أنه في دفاتر الطالب الآخر.">
          <Link to="/notebooks" className="btn btn-primary">
            العودة إلى الدفاتر
          </Link>
        </EmptyState>
      </div>
    )

  const activeIds = searchable.filter((b) => !off.includes(b))
  const output = data.outputs.find((o) => o.id === outputId)

  const addSource = () => setDialog('add')
  const openPack = (p: LessonPack, t: PackTool) => {
    setToolsOpen(false)
    const { output, keep } = packOutput(notebook, p, t)
    if (keep || data.outputs.some((o) => o.id === output.id)) {
      if (keep) actions.addOutput(output)
      setOutputId(output.id)
    } else setShown({ output, prepared: packLabel(p) })
  }
  const sources = (
    <LessonTree
      notebook={notebook}
      books={books}
      off={off}
      onOff={setOff}
      onAdd={addSource}
      onPick={(f) => {
        actions.openLesson(notebook.id, f)
        setTab('chat')
      }}
    />
  )
  const tools = (
    <LessonStudio
      notebook={notebook}
      focus={notebook.focus}
      activeIds={activeIds}
      onTool={(t) => (setToolsOpen(false), setTool(t))}
      onOpen={(o) => (setToolsOpen(false), setOutputId(o.id))}
      onShow={(output, prepared) => (setToolsOpen(false), setShown({ output, prepared }))}
      onPack={openPack}
    />
  )

  return (
    <div className="ws" data-hue={notebook.hue}>
      <header className="ws-head">
        <div className="ws-title">
          <span className="spine" aria-hidden="true" />
          <div>
            <h1>{notebook.title}</h1>
            <p className="muted">{notebook.subject}</p>
          </div>
        </div>
        <div className="ws-head-actions">
          {isWide && (
            <button className="btn btn-sm" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>
              <WandSparkles aria-hidden="true" /> أدوات الدرس
            </button>
          )}
          <button className="icon-btn" onClick={() => setDialog('edit')} aria-label="تعديل الدفتر" title="تعديل الدفتر">
            <Pencil />
          </button>
          <button className="icon-btn" disabled={!data.messages[chatOf(notebook)]?.length} onClick={() => actions.newChat(id)} aria-label="محادثة جديدة" title="محادثة جديدة">
            <MessageSquarePlus />
          </button>
          <button className="icon-btn" disabled={!notebook.chats?.length} onClick={() => setDialog('history')} aria-label="المحادثات السابقة" title="المحادثات السابقة">
            <History />
          </button>
        </div>
      </header>

      {!isWide && (
        <div className="ws-tabs segmented" role="tablist" aria-label="أقسام الدفتر">
          <button role="tab" aria-selected={tab === 'lessons'} onClick={() => setTab('lessons')}>
            <BookMarked aria-hidden="true" /> الدروس
          </button>
          <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            <GraduationCap aria-hidden="true" /> ادرس مع رفيق
          </button>
          <button role="tab" aria-selected={tab === 'studio'} onClick={() => setTab('studio')}>
            <WandSparkles aria-hidden="true" /> أدوات الدرس
          </button>
        </div>
      )}
      {(isWide || tab === 'lessons') && (
        <aside className="ws-side" aria-labelledby="src-h">
          <h2 id="src-h">المصادر والدروس <span className="count">{num(books.length)}</span></h2>
          {sources}
        </aside>
      )}
      {(isWide || tab === 'chat') && <ChatPanel key={chatOf(notebook)} notebook={notebook} books={books} activeIds={activeIds} onAddSource={addSource} onOpenOutput={(o) => setOutputId(o.id)} onTools={() => (isWide ? setToolsOpen(true) : setTab('studio'))} onPack={openPack} />}
      {!isWide && tab === 'studio' && (
        <aside className="ws-side" aria-labelledby="tools-h">
          <h2 id="tools-h">أدوات الدرس</h2>
          {tools}
        </aside>
      )}
      {isWide && toolsOpen && (
        <Dialog variant="end" title="أدوات الدرس" onClose={() => setToolsOpen(false)}>
          <div className="ws-side ws-drawer">{tools}</div>
        </Dialog>
      )}

      {dialog === 'add' && <AddSourceDialog notebook={notebook} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <NotebookForm notebook={notebook} onClose={() => setDialog(null)} />}
      {dialog === 'history' && (
        <Dialog title="المحادثات السابقة" onClose={() => setDialog(null)}>
          <ul className="saved">
            {(notebook.chats ?? []).map((c) => (
              <li key={c.id} className="source-row">
                <button
                  className="saved-open"
                  onClick={() => {
                    actions.openChat(id, c.id)
                    setDialog(null)
                  }}
                >
                  <History aria-hidden="true" />
                  <span className="grow">
                    <span className="book-title">{c.title}</span>
                    <small className="muted">
                      {num(data.messages[c.id]?.length ?? 0)} رسالة، {ago(c.at)}
                    </small>
                  </span>
                </button>
                <button className="icon-btn" onClick={() => actions.deleteChat(id, c.id)} aria-label={`حذف «${c.title}»`}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {tool && (
        <Suspense fallback={null}>
          <ToolDialog
            kind={tool}
            notebook={notebook}
            books={books.filter((b) => activeIds.includes(b.id))}
            onClose={() => setTool(null)}
            onDone={(o) => {
              setTool(null)
              setOutputId(o.id)
            }}
          />
        </Suspense>
      )}
      {output && (
        <Suspense fallback={null}>
          <OutputDialog key={output.id} output={output} onClose={() => setOutputId(null)} prepared={output.id.startsWith('pk-') ? 'من المحتوى الجاهز للدرس. تقدمك فيه محفوظ لك.' : undefined} />
        </Suspense>
      )}
      {shown && (
        <Suspense fallback={null}>
          <OutputDialog key={shown.output.id} output={shown.output} prepared={shown.prepared} onClose={() => setShown(null)} />
        </Suspense>
      )}
    </div>
  )
}
