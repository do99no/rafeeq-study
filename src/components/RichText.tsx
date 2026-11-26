import { useId, useState, type ReactNode } from 'react'
import { BookOpenText } from 'lucide-react'
import { num } from '../lib/format'
import { openPage } from '../store/viewer'
import type { Citation } from '../types'

/** عرض آمن لتنسيق محدود: **عريض** و`معادلة` و[رقم] استشهاد. */
function inline(text: string, onCite?: (n: number) => ReactNode): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g).map((part, i) => {
    if (part.startsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <bdi key={i} dir="ltr" className="formula">
          {part.slice(1, -1)}
        </bdi>
      )
    const n = part.match(/^\[(\d+)\]$/)
    if (n) return onCite ? <span key={i}>{onCite(Number(n[1]))}</span> : null
    return part
  })
}

export function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>
}

/** رقما الصفحة منفصلان دائماً كي لا يختلطا */
export const pageLabel = (c: Citation) => `ص ${num(c.page)} في PDF${c.printed ? `، والمطبوع ${/^\d+$/.test(c.printed) ? num(Number(c.printed)) : c.printed}` : ''}${c.ocr ? '، نص مصوَّر' : ''}`
export const openCite = (c: Citation) => openPage({ bookId: c.bookId, page: c.page, quote: c.quote })

export function CiteLink({ cite }: { cite: Citation }) {
  return (
    <button className="cite-chip" onClick={() => openCite(cite)}>
      <BookOpenText aria-hidden="true" /> {cite.bookTitle}
      {cite.section ? `، ${cite.section}` : ''}، {pageLabel(cite)}
    </button>
  )
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/
const BULLET = /^\s*[-•*]\s+(.*)$/
const NUMBERED = /^\s*([0-9٠-٩]+)[.)]\s+(.*)$/
const QUOTE = /^\s*>/
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** يحوّل النص إلى كتل: عناوين، فقرات، قوائم، جداول، وإضافات رفيق المميزة عن الكتاب */
function blocksOf(text: string, cite?: (n: number) => ReactNode): ReactNode[] {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const k = blocks.length
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const body: string[][] = []
      i += 2
      while (i < lines.length && TABLE_ROW.test(lines[i])) body.push(cells(lines[i++]))
      blocks.push(
        <div key={k} className="table-wrap" tabIndex={0} role="region" aria-label="جدول">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c.replace(/\*\*/g, ''), cite)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, x) => (
                <tr key={x}>
                  {head.map((_, j) => (
                    <td key={j}>{inline(r[j] ?? '', cite)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (QUOTE.test(line)) {
      const box: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) box.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(
        <aside key={k} className="extra">
          <small>من رفيق، ليس من الكتاب</small>
          {box
            .filter((b) => b.trim())
            .map((b, j) => (
              <p key={j}>{inline(b.replace(/^\s*[-•*]\s+/, '• ').replace(/\[\d+\]/g, ''))}</p>
            ))}
        </aside>,
      )
      continue
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const re = NUMBERED.test(line) ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i].match(re)!.at(-1)!
        i++
        // سطر تابع بمسافة بادئة يُلحق بالبند نفسه
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) item += `\n${lines[i++].trim()}`
        items.push(item)
      }
      const lis = items.map((l, j) => (
        <li key={j}>
          {l.split('\n').map((p, x) => (
            <span key={x} className={x ? 'li-more' : undefined}>
              {inline(p, cite)}
            </span>
          ))}
        </li>
      ))
      blocks.push(re === NUMBERED ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>)
      continue
    }
    const head = line.match(/^\s*#{1,4}\s+(.*)$/)
    if (head) blocks.push(<h4 key={k}>{inline(head[1].replace(/\*\*/g, ''), cite)}</h4>)
    else if (line.trim()) blocks.push(<p key={k}>{inline(line, cite)}</p>)
    i++
  }
  return blocks
}

export function RichText({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const [openN, setOpenN] = useState<number | null>(null)
  const panelId = useId()
  const open = citations.find((c) => c.n === openN)

  const cite = (n: number) => {
    const c = citations.find((x) => x.n === n)
    if (!c) return null
    return (
      <button className="cite" aria-expanded={openN === n} aria-controls={panelId} aria-label={`استشهاد ${num(n)}: ${c.bookTitle}، ${pageLabel(c)}`} onClick={() => setOpenN(openN === n ? null : n)}>
        {num(n)}
      </button>
    )
  }

  return (
    <div className="rich">
      {blocksOf(text, cite)}
      <div id={panelId}>
        {open && (
          <blockquote className="cite-quote">
            <p>{inline(open.quote)}</p>
            {open.weak && <p className="muted">في هذه الصفحة رسوم أو معادلات أو رموز لم تُقرأ. راجعها في الصفحة الأصلية.</p>}
            {open.ocr && <p className="muted">قُرئ هذا النص من صورة، فتحقق من الرموز والمعادلات في الصفحة الأصلية.</p>}
            <footer>
              <CiteLink cite={open} />
            </footer>
          </blockquote>
        )}
      </div>
      {citations.length > 0 && (
        <details className="sources" open={citations.length <= 4}>
          <summary>المصادر ({num(citations.length)})</summary>
          <div className="cites">
            {citations.map((c) => (
              <span key={c.n} className="cite-line">
                <b>{num(c.n)}</b> <CiteLink cite={c} />
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
