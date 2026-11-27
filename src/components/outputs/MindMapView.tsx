import { useState } from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, ZoomIn, ZoomOut } from 'lucide-react'
import { num } from '../../lib/format'
import type { MindNode } from '../../types'
import { Inline, openCite, pageLabel } from '../RichText'

/** all: فتح الفروع كلها أو طيّها معاً؛ epoch يتغير مع كل أمر فيُعاد ضبط الحالة */
function Node({ node, depth, all }: { node: MindNode; depth: number; all: { open: boolean; epoch: number } | null }) {
  const [state, setState] = useState<{ open: boolean; epoch: number }>({ open: depth < 2, epoch: 0 })
  const open = all && all.epoch > state.epoch ? all.open : state.open
  const kids = node.children ?? []
  const { cite } = node
  return (
    <li>
      {kids.length ? (
        <button className="mm-node" data-depth={depth} aria-expanded={open} onClick={() => setState({ open: !open, epoch: all?.epoch ?? 0 })}>
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
            <Node key={i} node={k} depth={depth + 1} all={all} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MindMapView({ root }: { root: MindNode }) {
  const [scale, setScale] = useState(1)
  const [all, setAll] = useState<{ open: boolean; epoch: number } | null>(null)
  const set = (open: boolean) => setAll({ open, epoch: (all?.epoch ?? 0) + 1 })
  return (
    <div className="mindmap-wrap">
      <div className="mm-tools" role="toolbar" aria-label="أدوات الخريطة">
        <button className="icon-btn" onClick={() => setScale((s) => Math.min(1.6, s + 0.15))} aria-label="تكبير" title="تكبير">
          <ZoomIn />
        </button>
        <button className="icon-btn" onClick={() => setScale((s) => Math.max(0.7, s - 0.15))} aria-label="تصغير" title="تصغير">
          <ZoomOut />
        </button>
        <button className="icon-btn" onClick={() => set(true)} aria-label="فتح كل الفروع" title="فتح كل الفروع">
          <ChevronsUpDown />
        </button>
        <button className="icon-btn" onClick={() => set(false)} aria-label="طيّ كل الفروع" title="طيّ كل الفروع">
          <ChevronsDownUp />
        </button>
      </div>
      <div className="mindmap" style={{ fontSize: `${scale}em` }}>
        <ul>
          <Node node={root} depth={0} all={all} />
        </ul>
      </div>
    </div>
  )
}
