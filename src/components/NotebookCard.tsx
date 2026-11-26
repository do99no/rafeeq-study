import { useState } from 'react'
import { Pencil, Star, Trash2 } from 'lucide-react'
import type { Notebook } from '../types'
import { ago, booksCount } from '../lib/format'
import { Link } from '../router'
import { actions } from '../store/store'
import { ConfirmDialog } from './Dialog'
import { NotebookForm } from './NotebookForm'

export function NotebookCard({ nb, manage = false }: { nb: Notebook; manage?: boolean }) {
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  return (
    <article className="nb-card" data-hue={nb.hue}>
      <div className="nb-top">
        <span className="nb-subject">{nb.subject}</span>
        <button
          className="icon-btn fav"
          aria-pressed={nb.favorite}
          aria-label={nb.favorite ? `إزالة «${nb.title}» من المفضلة` : `إضافة «${nb.title}» إلى المفضلة`}
          onClick={() => actions.toggleFavorite(nb.id)}
        >
          <Star />
        </button>
      </div>
      <h3>
        <Link to={`/notebooks/${nb.id}`} className="stretched">
          {nb.title}
        </Link>
      </h3>
      <div className="nb-foot">
        <span className="muted">
          {booksCount(nb.bookIds.length)}، {ago(nb.lastOpenedAt)}
        </span>
        {manage && (
          <span className="nb-actions">
            <button className="icon-btn" onClick={() => setDialog('edit')} aria-label={`تعديل «${nb.title}»`}>
              <Pencil />
            </button>
            <button className="icon-btn" onClick={() => setDialog('delete')} aria-label={`حذف «${nb.title}»`}>
              <Trash2 />
            </button>
          </span>
        )}
      </div>
      {dialog === 'edit' && <NotebookForm notebook={nb} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="حذف الدفتر"
          text={`سيُحذف «${nb.title}» مع محادثته وملخصاته واختباراته. الكتب تبقى في مكتبتك.`}
          action="حذف الدفتر"
          onConfirm={() => actions.deleteNotebook(nb.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </article>
  )
}
