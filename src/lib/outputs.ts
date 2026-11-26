import { FileText, GitCompareArrows, Layers, ListChecks, Network, NotebookPen, type LucideIcon } from 'lucide-react'
import type { OutputKind, StudyOutput } from '../types'
import { cardsCount, questionsCount } from './format'

export const outputMeta: Record<OutputKind, { label: string; icon: LucideIcon }> = {
  summary: { label: 'ملخص', icon: FileText },
  quiz: { label: 'اختبار', icon: ListChecks },
  cards: { label: 'بطاقات', icon: Layers },
  mindmap: { label: 'خريطة ذهنية', icon: Network },
  compare: { label: 'مقارنة', icon: GitCompareArrows },
  note: { label: 'ملاحظة', icon: NotebookPen },
}

export function outputDetail(o: StudyOutput) {
  if (o.data.kind === 'quiz') return questionsCount(o.data.questions.length)
  if (o.data.kind === 'cards') return cardsCount(o.data.cards.length)
  return outputMeta[o.data.kind].label
}
