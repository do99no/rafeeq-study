import { normalize, overlap } from '../../lib/arabic'
import type { LessonPack } from './lessonPack'

/**
 * تحقق مستقل من إجابات المسائل: طلب منفصل يحل الأسئلة دون أن يرى الإجابات المحفوظة،
 * ثم تُقارن النتائج النهائية برمجياً (أعداد وكسور وخيارات). ما لا يتطابق يُعلَّم «يحتاج مراجعة» ولا يُحذف.
 * التطابق ليس برهاناً على الصحة؛ هو فحص إضافي يكشف التناقض.
 */
const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫,]/g, '.').replace(/−/g, '-')

/** الأعداد في نص: الكسور تُحسب (٣/٤ = 0.75)، والقيم مقربة */
export function numbersOf(text: string): number[] {
  const t = DIGITS(text)
  const out: number[] = []
  for (const m of t.matchAll(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/g)) {
    const d = Number(m[2])
    if (d) out.push(Number(m[1]) / d)
  }
  for (const m of t.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(m[0]))
  return out.map((x) => Math.round(x * 1e6) / 1e6)
}
const has = (list: number[], x: number) => list.some((y) => Math.abs(y - x) <= 1e-4 * Math.max(1, Math.abs(x)))

/** هل تتفق النتيجة المستقلة مع الإجابة المحفوظة؟ undefined: لا يمكن الحكم */
export function agrees(stored: string, independent: string, kind: string, options?: string[]): boolean | undefined {
  if (!independent.trim()) return undefined
  if (kind === 'mcq' && options) {
    const pick = options.find((o) => normalize(o) === normalize(independent)) ?? options.find((o) => normalize(independent).includes(normalize(o)))
    return pick ? normalize(pick) === normalize(stored) : undefined
  }
  if (kind === 'tf') {
    const a = /خط|false/i.test(normalize(independent)) ? 'خطأ' : /صح|true/i.test(normalize(independent)) ? 'صح' : ''
    return a ? a === stored : undefined
  }
  const ind = numbersOf(independent)
  if (ind.length) {
    const st = numbersOf(stored)
    // النتيجة النهائية المستقلة يجب أن ترد في الإجابة المحفوظة (التي فيها الخطوات والناتج)
    const last = ind.slice(-Math.min(ind.length, 2))
    return last.every((x) => has(st, x))
  }
  return overlap(independent, stored) >= 0.5
}

export interface SolveItem {
  key: string
  q: string
  kind: string
  options?: string[]
  stored: string
}
export const itemsToSolve = (p: LessonPack): SolveItem[] => [
  ...p.quiz.map((q, i) => ({ key: `quiz:${i}`, q: q.q, kind: q.type, options: q.options, stored: q.answer })),
  ...p.worksheet.map((w, i) => ({ key: `ws:${i}`, q: w.q, kind: w.type, stored: w.answer })),
  ...p.steps.flatMap((s, i) => (s.check ? [{ key: `step:${i}`, q: s.check.q, kind: s.check.options ? 'mcq' : 'short', options: s.check.options, stored: s.check.answer }] : [])),
]

export const SOLVE_ASK = (items: SolveItem[]) => `حلّ الأسئلة التالية بنفسك من المقاطع وصور الصفحات، بدقة وتحقق من كل حساب. لا تشرح. أخرج JSON واحداً فقط بالشكل:
{"answers":[{"i":1,"final":"الناتج النهائي فقط: العدد أو التعبير، أو نص الخيار الصحيح، أو صح/خطأ"}]}
إذا لم تستطع الحل من المقاطع فاكتب "final":"".

${items.map((x, i) => `${i + 1}. ${x.q}${x.options ? `\nالخيارات: ${x.options.join(' | ')}` : ''}${x.kind === 'tf' ? '\n(أجب صح أو خطأ)' : ''}`).join('\n\n')}`

/** يطبّق نتائج الحل المستقل: يعلّم المختلف «يحتاج مراجعة»، ويعيد عدد ما فُحص وما عُلِّم */
export function applyVerdicts(p: LessonPack, items: SolveItem[], finals: string[]) {
  let checked = 0
  let flagged = 0
  items.forEach((it, i) => {
    const ok = agrees(it.stored, finals[i] ?? '', it.kind, it.options)
    if (ok === undefined) return
    checked++
    if (ok) return
    flagged++
    const flag = `لم يتطابق مع حلّ مستقل (الناتج المستقل: ${finals[i].slice(0, 80)}). راجع الحل في صفحة الكتاب.`
    const [kind, idx] = it.key.split(':')
    const n = Number(idx)
    if (kind === 'quiz') p.quiz[n].flag = flag
    else if (kind === 'ws') p.worksheet[n].flag = flag
    else if (kind === 'step' && p.steps[n].check && !p.steps[n].check!.options) p.steps[n].check = { ...p.steps[n].check!, answer: `${p.steps[n].check!.answer} (تحتاج مراجعة)` }
  })
  return { checked, flagged }
}
