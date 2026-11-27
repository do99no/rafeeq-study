import { normalize } from '../../lib/arabic'
import type { LessonPack } from './lessonPack'

/**
 * تحقق مستقل من إجابات الرياضيات:
 * ١. طلب منفصل يحل الأسئلة دون أن يرى الإجابات المحفوظة.
 * ٢. مقارنة برمجية: تطابق بعد التوحيد، أو تطابق الأعداد والكسور، أو الخيار نفسه. الإجابات النصية (تعليل، مقال) لا يُحكم عليها آلياً.
 * ٣. ما اختلف عددياً يُعرض على طلب تحكيم ثالث يحسب بنفسه ويختار بين الإجابتين.
 * يبقى البند موسوماً «تحتاج مراجعة» ما لم يؤكد التحكيمُ الإجابةَ المحفوظة. لا تُستبدل إجابة آلياً.
 * التطابق ليس برهاناً على الصحة؛ هو فحص يكشف التناقض.
 */
export const REVIEW_V = 2
const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫]/g, '.').replace(/[−–]/g, '-')
/** توحيد للمقارنة الحرفية: دون مسافات وعلامات تنسيق */
const flat = (s: string) => normalize(DIGITS(s)).replace(/[\s`'"«»()[\]{}.,،:؛;]/g, '').replace(/\*\*/g, '')

/** الأعداد في نص: الكسور تُحسب (٣/٤ = 0.75)، والقيم مقربة */
export function numbersOf(text: string): number[] {
  // الكسر يُستبدل بقيمته، فلا يُعدّ بسطه ومقامه عددين مستقلين
  const t = DIGITS(text)
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/g, (m, a, b) => (Number(b) ? ` ${Number(a) / Number(b)} ` : m))
  return [...t.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => Math.round(Number(m[0]) * 1e6) / 1e6)
}
const has = (list: number[], x: number) => list.some((y) => Math.abs(y - x) <= 1e-4 * Math.max(1, Math.abs(x)))

/** هل تتفق النتيجة المستقلة مع الإجابة المحفوظة؟ undefined: لا يمكن الحكم آلياً */
export function agrees(stored: string, independent: string, kind: string, options?: string[]): boolean | undefined {
  if (!independent.trim()) return undefined
  if (flat(independent) && flat(stored).includes(flat(independent))) return true
  if (kind === 'mcq' && options) {
    const pick = options.find((o) => flat(o) === flat(independent)) ?? options.find((o) => flat(independent).includes(flat(o)))
    return pick ? flat(pick) === flat(stored) : undefined
  }
  if (kind === 'tf') {
    const n = normalize(independent)
    const a = /خط|false/i.test(n) ? 'خطأ' : /صح|true/i.test(n) ? 'صح' : ''
    return a ? a === stored : undefined
  }
  // التعليل والمقال والإجابة القصيرة النصية: اختلاف الصياغة لا يعني الخطأ
  const ind = numbersOf(independent)
  if (!ind.length) return undefined
  const st = numbersOf(stored)
  if (!st.length) return undefined
  // النتيجة النهائية المستقلة يجب أن ترد في الإجابة المحفوظة (التي فيها الخطوات والناتج)
  return ind.slice(-Math.min(ind.length, 2)).every((x) => has(st, x))
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
]

export const SOLVE_ASK = (items: SolveItem[]) => `حلّ الأسئلة التالية بنفسك من المقاطع وصور الصفحات، بدقة وتحقق من كل حساب. لا تشرح. أخرج JSON واحداً فقط بالشكل:
{"answers":[{"i":1,"final":"الناتج النهائي فقط: العدد أو التعبير، أو نص الخيار الصحيح، أو صح/خطأ"}]}
إذا لم تستطع الحل من المقاطع فاكتب "final":"".

${items.map((x, i) => `${i + 1}. ${x.q}${x.options ? `\nالخيارات: ${x.options.join(' | ')}` : ''}${x.kind === 'tf' ? '\n(أجب صح أو خطأ)' : ''}`).join('\n\n')}`

export const JUDGE_ASK = (list: { q: string; a: string; b: string; options?: string[] }[]) => `لكل سؤال إجابتان مقترحتان مختلفتان. احسب الحل بنفسك خطوة خطوة في ذهنك وتحقق منه (بالتعويض أو بطريقة ثانية)، ثم اختر: "A" إذا كانت الإجابة A صحيحة، أو "B" إذا كانت B الصحيحة، أو "none" إذا كانتا خاطئتين أو لم تستطع التأكد. أخرج JSON فقط:
{"verdicts":[{"i":1,"pick":"A|B|none","final":"الناتج الذي وصلت إليه"}]}

${list.map((x, i) => `${i + 1}. ${x.q}${x.options ? `\nالخيارات: ${x.options.join(' | ')}` : ''}\nA: ${x.a.slice(0, 600)}\nB: ${x.b.slice(0, 200)}`).join('\n\n')}`

export const FLAG_TEXT = 'لم تؤكد المراجعة الآلية المستقلة هذه الإجابة؛ راجعها في صفحة الكتاب قبل الاعتماد عليها.'

/** يحسم المقارنة: يعيد البنود المختلفة عددياً (للتحكيم) ويعلّم ما لا يُحسم */
export function compare(items: SolveItem[], finals: string[]) {
  const disputed: { item: SolveItem; final: string }[] = []
  let checked = 0
  items.forEach((it, i) => {
    const ok = agrees(it.stored, finals[i] ?? '', it.kind, it.options)
    if (ok === undefined) return
    checked++
    if (!ok) disputed.push({ item: it, final: finals[i] })
  })
  return { checked, disputed }
}

/** يضع العلامة على البند (والقيمة المستقلة للمسؤول فقط) */
export function flagItem(p: LessonPack, key: string, note: string) {
  const [kind, idx] = key.split(':')
  const x = kind === 'quiz' ? p.quiz[Number(idx)] : p.worksheet[Number(idx)]
  if (!x) return
  x.flag = FLAG_TEXT
  ;(x as { flagNote?: string }).flagNote = note.slice(0, 200)
}
