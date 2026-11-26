import type { StudentData } from '../types'

export const emptyData = (): StudentData => ({
  notebooks: [], books: [], messages: {}, outputs: [], attempts: [],
  settings: { theme: 'light', textSize: 'normal', digits: 'arab' },
})

/**
 * ينقل بيانات المرحلة الأولى دون محتواها التجريبي: كانت كل الإجابات والمخرجات
 * حينها من نصوص وهمية بأرقام صفحات افتراضية. الأصل يبقى محفوظاً تحت v1.
 */
export function migrateV1(old: StudentData): StudentData {
  const demo = new Set(['nb-phys', 'nb-bio', 'nb-ar'])
  const isDemoBook = (id: string) => id.startsWith('demo-')
  const base = emptyData()
  return {
    ...base,
    settings: { ...base.settings, ...old.settings },
    books: (old.books ?? []).filter((b) => b.kind === 'pdf').map(({ id, title, sizeBytes, addedAt }) => ({ id, title, kind: 'pdf', sizeBytes, addedAt })),
    notebooks: (old.notebooks ?? []).filter((n) => !demo.has(n.id)).map((n) => ({ ...n, bookIds: n.bookIds.filter((b) => !isDemoBook(b)) })),
  }
}

/** فحص ملف النسخة الاحتياطية قبل قبوله */
export function parseBackup(raw: unknown): StudentData | null {
  const d = (raw as { data?: unknown } | null)?.data as StudentData | undefined
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!obj(d) || !Array.isArray(d.notebooks) || !Array.isArray(d.books) || !Array.isArray(d.outputs) || !Array.isArray(d.attempts) || !obj(d.messages)) return null
  const s = (v: unknown) => typeof v === 'string'
  const n = (v: unknown) => typeof v === 'number'
  const ok =
    d.notebooks.every((x) => obj(x) && s(x.id) && s(x.title) && s(x.subject) && Array.isArray(x.bookIds) && x.bookIds.every(s) && n(x.lastOpenedAt)) &&
    d.books.every((x) => obj(x) && s(x.id) && s(x.title) && n(x.addedAt)) &&
    d.outputs.every((x) => obj(x) && s(x.id) && s(x.title) && s(x.notebookId) && obj(x.data) && validOutput(x.data)) &&
    d.attempts.every((x) => obj(x) && s(x.outputId) && n(x.score) && n(x.total)) &&
    Object.values(d.messages).every((l) => Array.isArray(l) && l.every((m) => obj(m) && s(m.id) && s(m.text) && (m.role === 'user' || m.role === 'assistant') && (m.citations === undefined || Array.isArray(m.citations))))
  if (!ok) return null
  const base = emptyData()
  const set = obj(d.settings) ? d.settings : base.settings
  return {
    notebooks: d.notebooks, books: d.books, messages: d.messages, outputs: d.outputs, attempts: d.attempts,
    settings: {
      theme: ['light', 'dark', 'auto'].includes(set.theme) ? set.theme : 'light',
      textSize: set.textSize === 'large' ? 'large' : 'normal',
      digits: set.digits === 'latn' ? 'latn' : 'arab',
    },
  }
}
function validOutput(d: Record<string, unknown>) {
  const text = (v: unknown) => typeof v === 'string'
  const cited = (v: unknown) => !!v && typeof v === 'object' && text((v as { bookId?: unknown }).bookId)
  if (d.kind === 'quiz') return Array.isArray(d.questions) && d.questions.every((q) => text(q?.q) && text(q?.answer) && cited(q?.cite))
  if (d.kind === 'cards') return Array.isArray(d.cards) && Array.isArray(d.known) && d.cards.every((c) => text(c?.front) && text(c?.back) && cited(c?.cite))
  if (d.kind === 'mindmap') return text((d.root as { label?: unknown } | null)?.label)
  return ['summary', 'compare', 'note'].includes(d.kind as string) && text(d.text) && Array.isArray(d.citations)
}
