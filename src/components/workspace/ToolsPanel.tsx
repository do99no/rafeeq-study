import { NotebookPen, Trash2 } from 'lucide-react'
import { ago } from '../../lib/format'
import { outputDetail, outputMeta } from '../../lib/outputs'
import { useAI } from '../../services/ai/manager'
import { actions, uid, useData } from '../../store/store'
import type { Notebook, StudyOutput } from '../../types'
import type { ToolKind } from './ToolDialog'

const KINDS: ToolKind[] = ['summary', 'quiz', 'cards', 'mindmap', 'compare']

interface Props {
  notebook: Notebook
  activeIds: string[]
  onTool: (k: ToolKind) => void
  onOpen: (o: StudyOutput) => void
}

export function ToolsPanel({ notebook, activeIds, onTool, onOpen }: Props) {
  const outputs = useData().outputs.filter((o) => o.notebookId === notebook.id)
  const { service, config } = useAI()
  const noAI = service.state === 'unset' && !config.ollama.on

  return (
    <div className="ws-panel-body">
      <div className="tools">
        {KINDS.map((k) => {
          const { label, icon: Icon } = outputMeta[k]
          return (
            <button key={k} className="tool" disabled={!activeIds.length || noAI} onClick={() => onTool(k)}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
        <button
          className="tool"
          onClick={() => {
            const o: StudyOutput = { id: uid(), notebookId: notebook.id, title: 'ملاحظة جديدة', createdAt: Date.now(), data: { kind: 'note', text: '', citations: [] } }
            actions.addOutput(o)
            onOpen(o)
          }}
        >
          <NotebookPen aria-hidden="true" />
          <span>ملاحظة</span>
        </button>
      </div>
      {noAI ? <p className="hint">أدوات الإنشاء تعمل بعد تفعيل الذكاء الاصطناعي من الإعدادات. الملاحظات والمحفوظات متاحة.</p> : !activeIds.length && <p className="hint">حدّد مصدراً جاهزاً لتفعيل الأدوات.</p>}
      {outputs.length > 0 && (
        <>
          <h3 className="ws-sub">المحفوظات</h3>
          <ul className="saved">
            {outputs.map((o) => {
              const Icon = outputMeta[o.data.kind].icon
              return (
                <li key={o.id} className="source-row">
                  <button className="saved-open" onClick={() => onOpen(o)}>
                    <Icon aria-hidden="true" />
                    <span className="grow">
                      <span className="book-title">{o.title}</span>
                      <small className="muted">
                        {outputDetail(o)}، {ago(o.createdAt)}
                      </small>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => actions.deleteOutput(o.id)} aria-label={`حذف «${o.title}»`}>
                    <Trash2 />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
