import { Shuffle, BookOpenCheck, CircleHelp, ClipboardList, FileText, Layers, ListChecks, Moon, Network, Sparkles, Target, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { num } from '../../lib/format'
import { hasTool, PACK_TOOLS, packOf, toolData, usePacks, type LessonPack, type PackTool } from '../../services/study/lessonPack'
import { getState } from '../../store/store'
import type { Focus, Notebook, StudyOutput } from '../../types'
import { ToolsPanel } from './ToolsPanel'
import type { ToolKind } from './ToolDialog'

const ICONS: Record<PackTool, LucideIcon> = {
  explain: BookOpenCheck, full: FileText, short: Zap, final: Moon, guide: ClipboardList, terms: Target, points: Sparkles, mistakes: TriangleAlert,
  mindmap: Network, match: Shuffle, qa: CircleHelp, cards: Layers, 'quiz-easy': ListChecks, 'quiz-medium': ListChecks, 'quiz-hard': ListChecks, worksheet: ClipboardList,
}

export const packLabel = (p: LessonPack) => (p.status === 'reviewed' ? 'محتوى جاهز راجعه المسؤول' : 'محتوى جاهز أعدّه رفيق من صفحات الكتاب، ولم يراجعه معلم')

/**
 * المخرج الجاهز بصيغة العارض. البطاقات والاختبارات تُحفظ في بيانات الطالب عند أول فتح،
 * ليُحفظ تقدمه فيها (ما عرفه، ومحاولاته)؛ والنصوص تُعرض من الحزمة مباشرة.
 */
export function packOutput(notebook: Notebook, p: LessonPack, t: PackTool): { output: StudyOutput; keep: boolean } {
  const id = `pk-${p.bookId}-${p.sectionId}-${t}`
  const saved = getState().data.outputs.find((o) => o.id === id)
  const label = PACK_TOOLS.find((x) => x.id === t)!.label
  const output = saved ?? { id, notebookId: notebook.id, title: `${label}: ${p.title}`, createdAt: Date.now(), data: toolData(p, t) }
  return { output, keep: !saved && t !== 'match' && (output.data.kind === 'quiz' || output.data.kind === 'cards') }
}

interface Props {
  notebook: Notebook
  focus?: Focus
  activeIds: string[]
  onPack: (p: LessonPack, t: PackTool) => void
  onTool: (k: ToolKind) => void
  onOpen: (o: StudyOutput) => void
}

export function LessonStudio({ notebook, focus, activeIds, onPack, onTool, onOpen }: Props) {
  usePacks()
  const p = focus ? packOf(focus.bookId, focus.sectionId) : undefined
  const tools = p ? PACK_TOOLS.filter((t) => hasTool(p, t.id)) : []
  return (
    <div className="ws-panel-body">
      {!focus ? (
        <p className="hint">اختر درساً من المصادر لتظهر أدواته الجاهزة: الشرح والملخصات والبطاقات والاختبارات.</p>
      ) : !p ? (
        <p className="hint">لم يُجهَّز محتوى «{focus.title}» بعد. يمكنك أن تدرسه مع رفيق مباشرة، أو أن تنشئ أدواته بنفسك أدناه.</p>
      ) : (
        <>
          <p className="ready-tag">
            <Sparkles aria-hidden="true" /> {packLabel(p)}
          </p>
          {(['read', 'practice'] as const).map((g) => (
            <section key={g} aria-label={g === 'read' ? 'للقراءة والمراجعة' : 'للتدريب'}>
              <h3 className="ws-sub">{g === 'read' ? 'اقرأ وراجع' : 'تدرّب'}</h3>
              <div className="tools">
                {tools.filter((t) => t.group === g).map((t) => {
                  const Icon = ICONS[t.id]
                  const n = t.id === 'cards' ? p.cards.length : t.id.startsWith('quiz') ? p.quiz.filter((q) => q.level === t.id.slice(5)).length : t.id === 'worksheet' ? p.worksheet.length : t.id === 'qa' ? p.qa.length : 0
                  return (
                    <button key={t.id} className="tool" onClick={() => onPack(p, t.id)}>
                      <Icon aria-hidden="true" />
                      <span>{t.label}</span>
                      {n > 0 && <small className="muted">{num(n)}</small>}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          {p.unseen.length > 0 && <p className="hint">لم يطّلع رفيق على الصفحات {p.unseen.map((x) => num(x)).join('، ')} عند التجهيز؛ راجعها في الكتاب.</p>}
        </>
      )}
      <details className="more-tools" open={!p}>
        <summary>أنشئ بنفسك واحفظ</summary>
        <ToolsPanel notebook={notebook} activeIds={activeIds} onTool={onTool} onOpen={onOpen} />
      </details>
    </div>
  )
}
