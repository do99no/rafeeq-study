import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { BookMarked, History, MessageSquarePlus, NotebookPen, Pencil, Trash2, WandSparkles } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { NotebookForm } from '../components/NotebookForm'
import { ChatPanel } from '../components/workspace/ChatPanel'
import { AddSourceDialog, SourcesPanel } from '../components/workspace/SourcesPanel'
import { ToolsPanel } from '../components/workspace/ToolsPanel'
import type { ToolKind } from '../components/workspace/ToolDialog'
import { ago, num } from '../lib/format'
import { useAI } from '../services/ai/manager'
import { isSearchable, useDocs } from '../services/books/process'
import { buildVectors } from '../services/rag/search'
import { Link } from '../router'
import { actions, chatOf, useData } from '../store/store'

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
  const [drawer, setDrawer] = useState<'sources' | 'tools' | null>(null)
  const [dialog, setDialog] = useState<'add' | 'edit' | 'history' | null>(null)
  const [outputId, setOutputId] = useState<string | null>(null)
  const [tool, setTool] = useState<ToolKind | null>(null)

  const exists = !!notebook
  useEffect(() => {
    if (exists) actions.touchNotebook(id)
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

  const addSource = () => {
    setDrawer(null)
    setDialog('add')
  }
  const sources = <SourcesPanel notebook={notebook} books={books} off={off} onOff={setOff} onAdd={addSource} />
  const tools = (
    <ToolsPanel
      notebook={notebook}
      activeIds={activeIds}
      onTool={(k) => {
        setDrawer(null)
        setTool(k)
      }}
      onOpen={(o) => {
        setDrawer(null)
        setOutputId(o.id)
      }}
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
          {!isWide && (
            <>
              <button className="btn btn-sm" onClick={() => setDrawer('sources')}>
                <BookMarked aria-hidden="true" /> المصادر <span className="count">{num(books.length)}</span>
              </button>
              <button className="btn btn-sm" onClick={() => setDrawer('tools')}>
                <WandSparkles aria-hidden="true" /> الأدوات
              </button>
            </>
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

      {isWide && (
        <aside className="ws-side" aria-labelledby="src-h">
          <h2 id="src-h">المصادر</h2>
          {sources}
        </aside>
      )}
      <ChatPanel key={chatOf(notebook)} notebook={notebook} books={books} activeIds={activeIds} onAddSource={addSource} onOpenOutput={(o) => setOutputId(o.id)} />
      {isWide && (
        <aside className="ws-side" aria-labelledby="tools-h">
          <h2 id="tools-h">أدوات الدراسة</h2>
          {tools}
        </aside>
      )}

      {!isWide && drawer === 'sources' && (
        <Dialog variant="start" title="المصادر" onClose={() => setDrawer(null)}>
          {sources}
        </Dialog>
      )}
      {!isWide && drawer === 'tools' && (
        <Dialog variant="end" title="أدوات الدراسة" onClose={() => setDrawer(null)}>
          {tools}
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
          <OutputDialog key={output.id} output={output} onClose={() => setOutputId(null)} />
        </Suspense>
      )}
    </div>
  )
}
