import { Eye, ImageOff, TriangleAlert } from 'lucide-react'
import { num } from '../../lib/format'
import { openPage } from '../../store/viewer'
import type { Message, PageRef } from '../../types'

const SHOW = 8

function Pages({ list }: { list: PageRef[] }) {
  return (
    <span className="page-list">
      {list.slice(0, SHOW).map((p) => (
        <button key={`${p.bookId}:${p.page}`} className="page-chip" onClick={() => openPage({ bookId: p.bookId, page: p.page })}>
          ص {num(p.page)}
        </button>
      ))}
      {list.length > SHOW && <span className="muted">و{num(list.length - SHOW)} غيرها</span>}
    </span>
  )
}

/** صراحة مع الطالب: ما قرأه رفيق من صور الصفحات، وما لم يطّلع عليه */
export function PagesNote({ pages }: { pages: NonNullable<Message['pages']> }) {
  return (
    <div className="pages-note">
      {!!pages.seen.length && (
        <p data-kind="seen">
          <Eye aria-hidden="true" /> اطّلع رفيق على صور الصفحات الأصلية، لا على نصها المقروء آلياً وحده: <Pages list={pages.seen} />
        </p>
      )}
      {!!pages.partial.length && (
        <p data-kind="partial">
          <TriangleAlert aria-hidden="true" /> سقطت معادلات أو رموز أو رسوم من النص المقروء آلياً في هذه الصفحات، فلم يطّلع عليها رفيق. راجعها في الكتاب: <Pages list={pages.partial} />
        </p>
      )}
      {!!pages.unread.length && (
        <p data-kind="unread">
          <ImageOff aria-hidden="true" /> صفحات من الدرس بلا نص مقروء لم يطّلع عليها رفيق: <Pages list={pages.unread} />
        </p>
      )}
    </div>
  )
}
