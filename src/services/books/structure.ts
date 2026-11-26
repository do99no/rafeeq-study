/** دوال خالصة لتحليل نص الكتاب: ترتيب الأسطر، الجودة، الأبواب، أرقام الصفحات، المقاطع. */
import { normalize, toLatinDigits } from '../../lib/arabic'
import type { Chunk, Line, PageRec, Section } from './types'

export interface TextItem {
  s: string
  x: number
  y: number
  w: number
  h: number
}

const AR = /[؀-ۿ]/
const AR_G = /[ء-ي]/g
const LAT_G = /[A-Za-z]/g
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0

/** أشكال العرض العربية فقط؛ NFKC على النص كله يفسد الأسس مثل x². */
const fixForms = (s: string) => s.replace(/[ﭐ-﷿ﹰ-﻿]+/g, (m) => m.normalize('NFKC'))
/** خطوط كثيرة تُخزَّن بحروف شبيهة (ی ھ ک) فيفشل البحث عنها */
const LOOKALIKE: Record<string, string> = { 'ی': 'ي', 'ۍ': 'ي', 'ې': 'ي', 'ھ': 'ه', 'ہ': 'ه', 'ە': 'ه', 'ک': 'ك', 'ڪ': 'ك', 'ۃ': 'ة' }
const sameLetters = (s: string) => s.replace(/[یۍېھہەکڪۃ]/g, (c) => LOOKALIKE[c])
/** تنظيف مشترك لنص PDF والتعرف الضوئي */
export const clean = (s: string) => sameLetters(fixForms(s)).replace(/[\u0000-\u0008\u000B-\u001F​-‏‪-‮⁦-⁩﻿]/g, '')

function renderLine(items: TextItem[]): string {
  const joined = items.map((i) => i.s).join('')
  const ar = count(joined, AR_G)
  const rtl = ar > 0 && ar >= count(joined, LAT_G) * 0.5
  let seq = [...items].sort((a, b) => (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x))
  if (rtl) {
    // المعادلات والأرقام داخل السطر العربي تُقرأ من اليسار
    const out: TextItem[] = []
    for (let i = 0; i < seq.length; ) {
      if (AR.test(seq[i].s)) {
        out.push(seq[i++])
        continue
      }
      let j = i
      while (j < seq.length && !AR.test(seq[j].s)) j++
      let a = i
      let b = j
      const edge = (t: TextItem) => !/[\p{L}\p{N}]/u.test(t.s) && !/[=+×÷√∑∫^()[\]{}]/.test(t.s)
      while (a < b && edge(seq[a])) a++
      while (b > a && edge(seq[b - 1])) b--
      out.push(...seq.slice(i, a), ...seq.slice(a, b).reverse(), ...seq.slice(b, j))
      i = j
    }
    seq = out
  }
  const base = items.reduce((m, i) => (i.h > m.h && i.s.trim() ? i : m), items[0])
  let text = ''
  let prev: TextItem | undefined
  for (const it of seq) {
    if (!it.s.trim()) {
      if (!text.endsWith(' ')) text += ' '
      prev = it
      continue
    }
    let s = it.s
    if (it.h < base.h * 0.88 && /^[\dA-Za-z+\-−n]{1,4}$/.test(s.trim())) {
      const dy = it.y - base.y
      if (dy > base.h * 0.2) s = `^${s.trim()}`
      else if (dy < -base.h * 0.08) s = `_${s.trim()}`
    }
    if (prev && text && !text.endsWith(' ')) {
      const gap = Math.max(it.x - (prev.x + prev.w), prev.x - (it.x + it.w))
      if (gap > base.h * 3) text += ' | '
      else if (gap > base.h * 0.12 && !/^[_^]/.test(s)) text += ' '
    }
    text += s
    prev = it
  }
  return text.replace(/ {2,}/g, ' ').replace(/ +(?=[\u064B-\u0652])/g, '').trim()
}

/** يحافظ على ترتيب الملف (فلا تختلط الأعمدة) ويرتب داخل السطر بحسب الموضع. */
export function buildLines(raw: TextItem[]): Line[] {
  const groups: { items: TextItem[]; y: number; h: number }[] = []
  for (const r of raw) {
    const it = { ...r, s: clean(r.s) }
    if (!it.s) continue
    const g = groups.at(-1)
    if (g && (!it.s.trim() || Math.abs(it.y - g.y) <= 0.5 * Math.max(it.h, g.h))) {
      g.items.push(it)
      if (it.s.trim() && it.h > g.h) Object.assign(g, { h: it.h, y: it.y })
    } else if (it.s.trim()) groups.push({ items: [it], y: it.y, h: it.h })
  }
  const gaps = groups.slice(1).map((g, i) => groups[i].y - g.y).filter((d) => d > 0).sort((a, b) => a - b)
  const mid = gaps[gaps.length >> 1] ?? 0
  return groups.flatMap((g, i) => {
    const t = renderLine(g.items)
    if (!t) return []
    const d = i ? groups[i - 1].y - g.y : 0
    return [{ t, h: Math.round(g.h * 10) / 10, gap: i > 0 && (d < 0 || d > mid * 1.6) }]
  })
}

/** هل النص المستخرج مقروء فعلاً؟ بعض ملفات PDF العربية ترميزها تالف. */
export function textQuality(text: string): 'ok' | 'empty' | 'broken' {
  const t = text.replace(/\s/g, '')
  if (t.length < 25) return 'empty'
  if (count(t, /[-�]/g) / t.length > 0.04) return 'broken'
  const letters = count(t, AR_G) + count(t, LAT_G)
  if (count(t, /[¡-ÿƒˆ†-•‰]/g) > letters * 0.4) return 'broken'
  // ترميز تالف يظهر رموزاً وحروفاً مفردة بلا كلمات
  if (letters < t.length * 0.45) return 'broken'
  const runs = text.match(/\p{L}+/gu) ?? []
  if (runs.length >= 15 && runs.filter((w) => w.length >= 3).length < runs.length * 0.35) return 'broken'
  const lat = text.match(/[A-Za-z]{2,}/g) ?? []
  if (lat.length >= 30 && count(t, AR_G) < letters * 0.2 && !/\b(the|of|and|is|to|in|a|he|she|it|I|verb|noun|past)\b/i.test(text)) return 'broken'
  const words = text.match(/[ء-ي]{2,}/g) ?? []
  if (words.length >= 40) {
    const al = words.filter((w) => /^[وفبكل]?ال/.test(w) || /^لل/.test(w)).length
    const rev = words.filter((w) => w.endsWith('لا') && w.length > 3).length
    const common = words.filter((w) => /^(في|من|على|إلى|الى|عن|أن|ان|هو|هي|هذا|هذه|التي|الذي|كل|ما|أو|او|مع|بين|لا)$/.test(w)).length
    if (rev > al || (al + common) / words.length < 0.07) return 'broken'
  }
  return 'ok'
}

export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' | 'unknown' {
  const ar = count(text, AR_G)
  const en = count(text, LAT_G)
  if (ar + en < 50) return 'unknown'
  const r = ar / (ar + en)
  return r > 0.75 ? 'ar' : r < 0.25 ? 'en' : 'mixed'
}

export interface OcrLine {
  t: string
  h: number
  c: number
  gap: boolean
}
/** سطر ثقته أقل من هذا الحد غالباً معادلة أو رسم: لا يدخل الفهرس كي لا تُنسب للكتاب رموز خاطئة. */
export const MIN_LINE = 50
export const MIN_PAGE = 60

export function judgeOcr(raw: OcrLine[]): { lines: Line[]; ok: boolean; weak: number } {
  const all = raw.map((l) => ({ ...l, t: clean(l.t).replace(/\s+/g, ' ').trim() })).filter((l) => l.t)
  // سطر فيه أرقام أو رموز وقليل من الكلمات الحقيقية: غالباً معادلة قُرئت خطأ حتى لو ارتفعت ثقتها
  const words = (t: string) => (t.match(/[ء-يA-Za-z]{3,}/g) ?? []).length
  const formula = (t: string) => /[0-9٠-٩=+×÷√^()<>]/.test(t) && words(t) < 3 && t.length < 60
  // أسطر الرأس والذيل تبقى: فيها أرقام الصفحات المطبوعة
  const edge = (i: number) => i < 2 || i >= all.length - 2
  const good = all.filter((l, i) => l.c >= MIN_LINE && /[\p{L}\p{N}]/u.test(l.t) && (edge(i) || !formula(l.t)))
  const hs = good.map((l) => l.h).sort((a, b) => a - b)
  const mid = hs[hs.length >> 1] || 1
  const size = good.reduce((s, l) => s + l.t.length, 0)
  const conf = size ? good.reduce((s, l) => s + l.c * l.t.length, 0) / size : 0
  const lines = good.map((l) => ({ t: l.t, h: l.h > mid * 1.6 ? 16 : 10, gap: l.gap }))
  const lost = all.filter((l) => !good.includes(l) && /[\p{L}\p{N}=+×÷√]{2,}/u.test(l.t) && (formula(l.t) || words(l.t) < 3)).length
  return { lines, ok: conf >= MIN_PAGE && textQuality(lines.map((l) => l.t).join('\n')) === 'ok', weak: lost >= 2 ? lost : 0 }
}

const PAGE_NO = /^[\s\-–—|•.()]*([0-9٠-٩]{1,4})[\s\-–—|•.()]*$/
const edgeLines = (p: PageRec, n: number) => (p.lines.length <= n * 2 ? p.lines : [...p.lines.slice(0, n), ...p.lines.slice(-n)])

/** الرقم المطبوع يُعتمد فقط إذا أيدته الصفحات المجاورة بالإزاحة نفسها. */
export function printedNumbers(pages: PageRec[], running: Set<string> = new Set()): Map<number, string> {
  const found = pages.map((p) => ({
    page: p.page,
    offs: new Set(
      edgeLines(p, 3).flatMap((l) => {
        // الرقم وحده، أو مع عنوان الكتاب المتكرر في الرأس أو الذيل
        const m = l.t.match(PAGE_NO) ?? (() => {
          const x = l.t.match(/^[s|/-–—]*([0-9٠-٩]{1,4})[s|/-–—]+(.+)$/) ?? l.t.match(/^(.+?)[s|/-–—]+([0-9٠-٩]{1,4})[s|/-–—]*$/)
          if (!x) return null
          const [num, rest] = /^[0-9٠-٩]/.test(x[1]) ? [x[1], x[2]] : [x[2], x[1]]
          return running.has(key(rest)) ? [l.t, num] : null
        })()
        return m ? [p.page - Number(toLatinDigits(m[1]))] : []
      }),
    ),
  }))
  const out = new Map<number, string>()
  for (let i = 0; i < found.length; i++) {
    const votes = new Map<number, { before: number; after: number; self: number }>()
    for (let j = Math.max(0, i - 6); j <= Math.min(found.length - 1, i + 6); j++)
      for (const o of found[j].offs) {
        const v = votes.get(o) ?? { before: 0, after: 0, self: 0 }
        if (j < i) v.before++
        else if (j > i) v.after++
        else v.self++
        votes.set(o, v)
      }
    const ranked = [...votes].map(([o, v]) => ({ o, v, n: v.before + v.after + v.self })).sort((a, b) => b.n - a.n)
    const best = ranked[0]
    if (!best || best.n < 3 || (ranked[1] && ranked[1].n === best.n)) continue
    if (!best.v.self && !(best.v.before && best.v.after)) continue
    const n = found[i].page - best.o
    if (n > 0) out.set(found[i].page, String(n))
  }
  return out
}

const ORD = '(?:ال)?(?:أول|اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي|أولى|اولى|ثانية|ثالثة|رابعة|خامسة|سادسة|سابعة|ثامنة|تاسعة|عاشرة|[0-9٠-٩]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)'
const ORDINALS: [RegExp, number][] = [
  [/حادي عشر|الحادية عشرة/, 11], [/ثاني عشر|الثانية عشرة/, 12], [/أول|اول|أولى|اولى|one/, 1], [/ثاني|ثانية|two/, 2], [/ثالث|three/, 3], [/رابع|four/, 4],
  [/خامس|five/, 5], [/سادس|six/, 6], [/سابع|seven/, 7], [/ثامن|eight/, 8], [/تاسع|nine/, 9], [/عاشر|ten/, 10],
]
function ordinal(t: string): number {
  const head = t.split(/[:،.(]/)[0]
  const d = toLatinDigits(head).match(/\d{1,2}/)
  if (d) return Number(d[0])
  return ORDINALS.find(([re]) => re.test(head))?.[1] ?? 0
}
const headWord = (t: string) => normalize(t).split(/\s+/)[0]
const CHAPTER = new RegExp(`^(?:الباب|الفصل|الوحدة|المحور|unit|chapter|module)\\s*[:(]?\\s*${ORD}(?![\\u0621-\\u064Aa-z])`, 'i')
const LESSON = new RegExp(`^(?:الدرس|الموضوع|lesson)\\s*[:(]?\\s*${ORD}(?![\\u0621-\\u064Aa-z])`, 'i')
const headingLevel = (t: string): 1 | 2 | 0 => (t.length > 90 ? 0 : CHAPTER.test(t) ? 1 : LESSON.test(t) ? 2 : 0)

const key = (t: string) => normalize(t).replace(/[\d\s|.\-–—]+/g, ' ').trim()

/** أسطر رأس وذيل الصفحة المتكررة */
function runningLines(pages: PageRec[]): Set<string> {
  const c = new Map<string, number>()
  for (const p of pages) for (const k of new Set(edgeLines(p, 2).map((l) => key(l.t)))) if (k) c.set(k, (c.get(k) ?? 0) + 1)
  const min = Math.max(4, pages.length * 0.15)
  return new Set([...c].filter(([, n]) => n >= min).map(([k]) => k))
}

export interface Bookmark {
  title: string
  level: 1 | 2
  page: number
}

const MAX = 1100
const MIN = 220

function splitLong(t: string): string[] {
  if (t.length <= MAX) return [t]
  const out: string[] = []
  let cur = ''
  for (const s of t.split(/(?<=[.؟!؛?])\s+/)) {
    if (cur && cur.length + s.length > MAX) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur} ${s}` : s
    while (cur.length > MAX * 1.6) {
      const at = cur.lastIndexOf(' ', MAX)
      const cut = at > 0 ? at : MAX
      out.push(cur.slice(0, cut))
      cur = cur.slice(cut).trim()
    }
  }
  if (cur) out.push(cur)
  return out
}

/** يبني الأبواب والمقاطع. كل مقطع داخل صفحة واحدة كي يبقى رقم الصفحة دقيقاً. */
export function analyze(bookId: string, pages: PageRec[], bookmarks: Bookmark[]) {
  const usable = pages.filter((p) => p.ok).sort((a, b) => a.page - b.page)
  const lastPage = pages.reduce((m, p) => Math.max(m, p.page), 0)
  const running = runningLines(usable)
  const printed = printedNumbers(pages, running)
  for (const p of pages) if (!printed.has(p.page) && p.label) printed.set(p.page, p.label)
  const heights = usable.flatMap((p) => p.lines.map((l) => l.h)).sort((a, b) => a - b)
  const body = heights[heights.length >> 1] ?? 10
  const useMarks = bookmarks.length >= 3

  const sections: Section[] = []
  const addSection = (title: string, level: 1 | 2, page: number) => {
    const id = `${sections.length + 1}`
    sections.push({ id, title: title.slice(0, 120), level, page, endPage: lastPage })
  }
  if (useMarks) bookmarks.forEach((b) => addSection(b.title, b.level, b.page))

  const chunks: Chunk[] = []
  let chapter: Section | undefined
  let lesson: Section | undefined

  for (const p of usable) {
    const tocPage = p.lines.filter((l) => headingLevel(l.t)).length >= 4 || p.lines.filter((l) => /(\.{4,}|…{2,})\s*[0-9٠-٩]{1,3}\s*$|^\s*[0-9٠-٩]{1,3}\s*(\.{4,}|…{2,})/.test(l.t)).length >= 3 || p.lines.some((l) => /^(الفهرس|المحتويات|فهرس|contents)$/i.test(l.t.trim()))
    if (useMarks)
      for (const s of sections)
        if (s.page <= p.page) {
          if (s.level === 1) {
            if (chapter !== s && (!chapter || s.page >= chapter.page)) {
              chapter = s
              lesson = undefined
            }
          } else lesson = s
        }
    if (useMarks && lesson && chapter && lesson.page < chapter.page) lesson = undefined

    let buf: string[] = []
    const emit = () => {
      const text = buf.join('\n').trim()
      buf = []
      if (text.length < 15) return
      for (const t of splitLong(text))
        chunks.push({
          bookId, i: chunks.length, page: p.page, printed: printed.get(p.page),
          sectionId: (lesson ?? chapter)?.id, chapter: chapter?.title, lesson: lesson?.title, ...{ _c: chapter?.id, _l: lesson?.id }, text: t, ...(p.src === 'ocr' ? { ocr: true } : {}), ...(p.weak ? { weak: true } : {}),
        })
    }
    let para = ''
    const endPara = () => {
      if (!para) return
      if (buf.length && buf.join('\n').length + para.length > MAX) emit()
      buf.push(para)
      para = ''
    }
    p.lines.forEach((l, idx) => {
      const edge = idx < 2 || idx >= p.lines.length - 2
      if ((idx < 3 || idx >= p.lines.length - 3) && PAGE_NO.test(l.t)) return
      const level = useMarks || tocPage ? 0 : headingLevel(l.t)
      if (level) {
        const cur = level === 1 ? chapter : lesson
        if (!cur || normalize(cur.title) !== normalize(l.t)) {
          endPara()
          emit()
          // عنوان الفصل كثيراً ما يأتي في السطر التالي
          const next = p.lines[idx + 1]
          const full = l.t.length < 25 && next && !headingLevel(next.t) && !PAGE_NO.test(next.t) && next.t.length < 60 && next.h >= Math.max(body * 1.1, l.h * 0.85) ? `${l.t}: ${next.t}` : l.t
          if (!cur || !normalize(cur.title).startsWith(normalize(l.t))) {
            addSection(full, level, p.page)
            if (level === 1) {
              chapter = sections.at(-1)
              lesson = undefined
            } else lesson = sections.at(-1)
          }
        }
        if (edge && running.has(key(l.t))) return
      } else if (edge && !l.t.includes(' | ') && running.has(key(l.t))) return
      const prev = p.lines[idx - 1]
      const bullet = /^([•▪●◆*\-–]|[0-9٠-٩]{1,2}\s*[-.)])\s*/.test(l.t)
      const newPara = l.gap || bullet || level > 0 || l.t.includes(' | ') || (prev && Math.abs(prev.h - l.h) > body * 0.15) || (prev && /[.؟!:]$/.test(prev.t) && prev.t.length < 45)
      if (newPara) {
        endPara()
        if (l.gap && buf.join('\n').length >= MIN * 3) emit()
        // العنوان الفرعي يبدأ مقطعاً جديداً
        if (l.h > body * 1.15 && l.t.length < 80 && buf.join('\n').length >= MIN) emit()
      }
      para = para ? `${para} ${l.t}` : l.t
    })
    endPara()
    emit()
  }

  sections.forEach((s, i) => {
    const next = sections.slice(i + 1).find((n) => n.level <= s.level)
    if (next) s.endPage = Math.max(s.page, next.page > s.page ? next.page - 1 : s.page)
  })
  // العنوان المكتشف من النص يُعتمد فقط إذا ثبتت نهايته: التالي من مستواه يحمل الرقم الذي يليه
  // (أو يبدأ وحدة جديدة). غير ذلك يعني أن عنواناً بينهما لم يُقرأ، فلا نخمّن حدود الدرس.
  const bad = new Set<string>()
  if (!useMarks)
    sections.forEach((s, i) => {
      const rest = sections.slice(i + 1)
      const next = rest.find((n) => n.level <= s.level)
      // وحدتان في صفحة واحدة، أو وحدة أقصر من 3 صفحات: غالباً من صفحة الفهرس
      if (s.level === 1 && (sections.some((o) => o !== s && o.level === 1 && o.page === s.page) || s.endPage - s.page < 2)) return void bad.add(s.id)
      if (!next) return
      if (next.level < s.level) return
      const a = ordinal(s.title)
      const b = ordinal(next.title)
      if (!a || !b || b !== a + 1 || headWord(s.title) !== headWord(next.title)) bad.add(s.id)
    })
  const kept = sections.filter((s) => !bad.has(s.id))
  for (const c of chunks as (Chunk & { _c?: string; _l?: string })[]) {
    if (c._c && bad.has(c._c)) delete c.chapter
    if (c._l && bad.has(c._l)) delete c.lesson
    if (c.sectionId && bad.has(c.sectionId)) c.sectionId = c._l && !bad.has(c._l) ? c._l : c._c && !bad.has(c._c) ? c._c : undefined
    if (!c.sectionId) delete c.sectionId
    delete c._c
    delete c._l
  }
  return { sections: kept, chunks, printed }
}
