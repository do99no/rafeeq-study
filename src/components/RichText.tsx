import { useId, useState, type ReactNode } from 'react'
import { BookOpenText } from 'lucide-react'
import { num } from '../lib/format'
import { openPage } from '../store/viewer'
import type { Citation } from '../types'

/** عرض آمن لتنسيق محدود: **عريض** و`معادلة` و- قوائم و[رقم] استشهاد. */
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
    if (n && onCite) return <span key={i}>{onCite(Number(n[1]))}</span>
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

  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l, cite)}</li>
          ))}
        </ul>,
      )
    list = []
  }
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*[-•*]\s+(.*)$/)
    if (item) list.push(item[1])
    else {
      flush()
      const head = line.match(/^#{1,4}\s+(.*)$/)
      if (line.trim()) blocks.push(<p key={blocks.length}>{head ? <strong>{inline(head[1].replace(/\*\*/g, ''), cite)}</strong> : inline(line, cite)}</p>)
    }
  }
  flush()

  return (
    <div className="rich">
      {blocks}
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
