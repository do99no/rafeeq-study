import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { num } from '../../lib/format'
import type { MindNode } from '../../types'
import { Inline, openCite, pageLabel } from '../RichText'

function Node({ node, depth }: { node: MindNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const kids = node.children ?? []
  const { cite } = node
  return (
    <li>
      {kids.length ? (
        <button className="mm-node" data-depth={depth} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Inline text={node.label} />
          <ChevronDown aria-hidden="true" />
        </button>
      ) : (
        <span className="mm-node" data-depth={depth}>
          <Inline text={node.label} />
        </span>
      )}
      {cite && (
        <button className="cite mm-cite" onClick={() => openCite(cite)} aria-label={`${cite.bookTitle}، ${pageLabel(cite)}`}>
          ص {num(cite.page)}
        </button>
      )}
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k, i) => (
            <Node key={i} node={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MindMapView({ root }: { root: MindNode }) {
  return (
    <div className="mindmap">
      <ul>
        <Node node={root} depth={0} />
      </ul>
    </div>
  )
}
