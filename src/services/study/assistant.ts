import type { Citation } from '../../types'
import type { Hit } from '../rag/types'

/** أدوات مشتركة: نص المقاطع المرقمة للنموذج، والاستشهادات الموثقة. */
export const whereOf = (h: { chapter?: string; lesson?: string }) => h.lesson ?? h.chapter

export const passagesText = (hits: Hit[], start = 1) =>
  hits.map((h, i) => `[${start + i}] (الكتاب: ${h.bookTitle}${whereOf(h) ? `، ${whereOf(h)}` : ''}${h.ocr ? '، نص مصوَّر قد تخطئ رموزه' : ''}${h.weak ? '، سقطت منه رسوم أو معادلات أو رموز' : ''})\n${h.text}`).join('\n\n')

export const toCitation = (h: Hit, n: number): Citation => ({
  n, bookId: h.bookId, bookTitle: h.bookTitle, page: h.page, printed: h.printed, section: whereOf(h), chunk: h.i, ...(h.ocr ? { ocr: true } : {}), ...(h.weak ? { weak: true } : {}),
  quote: h.text.length > 420 ? `${h.text.slice(0, 420)}…` : h.text,
})

/** يوحّد أشكال الاستشهاد ويحذف أي رقم لا يقابله مقطع حقيقي. */
export function cleanCites(text: string, max: number): { text: string; used: number[] } {
  const used = new Set<number>()
  const out = text.replace(/[[【]\s*((?:[\d٠-٩]+\s*[,،\-–]?\s*)+)[\]】]/g, (_, list: string) =>
    (list.match(/[\d٠-٩]+/g) ?? [])
      .map((d) => Number(d.replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x660))))
      .filter((n) => n >= 1 && n <= max)
      .map((n) => {
        used.add(n)
        return `[${n}]`
      })
      .join(''),
  )
  return { text: out, used: [...used].sort((a, b) => a - b) }
}
