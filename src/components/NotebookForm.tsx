import { useState } from 'react'
import type { Hue, Notebook } from '../types'
import { go } from '../router'
import { actions, useData } from '../store/store'
import { BookChecklist } from './BookChecklist'
import { Dialog } from './Dialog'
import { PdfPicker } from './PdfPicker'

const HUES: { id: Hue; label: string }[] = [
  { id: 'violet', label: 'بنفسجي' },
  { id: 'teal', label: 'تركواز' },
  { id: 'plum', label: 'برقوقي' },
  { id: 'indigo', label: 'نيلي' },
  { id: 'olive', label: 'زيتوني' },
  { id: 'clay', label: 'طيني' },
]
const SUBJECTS = ['اللغة العربية', 'اللغة الإنجليزية', 'الفيزياء', 'الكيمياء', 'الأحياء', 'الرياضيات', 'الجيولوجيا', 'التاريخ', 'الجغرافيا', 'علم النفس', 'الإحصاء']

/** إنشاء دفتر مع إضافة كتبه في خطوة واحدة، أو تعديل دفتر قائم. */
export function NotebookForm({ notebook, onClose }: { notebook?: Notebook; onClose: () => void }) {
  const { books } = useData()
  const [title, setTitle] = useState(notebook?.title ?? '')
  const [subject, setSubject] = useState(notebook?.subject ?? '')
  const [hue, setHue] = useState<Hue>(notebook?.hue ?? 'violet')
  const [bookIds, setBookIds] = useState(notebook?.bookIds ?? [])

  return (
    <Dialog title={notebook ? 'تعديل الدفتر' : 'دفتر جديد'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          const input = { title: title.trim(), subject: subject.trim() || 'عام', hue, bookIds }
          if (!input.title) return
          if (notebook) actions.editNotebook(notebook.id, input)
          else go(`/notebooks/${actions.createNotebook(input)}`)
          onClose()
        }}
      >
        <label className="field">
          <span>اسم الدفتر</span>
          <input autoFocus required pattern=".*\S.*" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: الباب الأول في الكيمياء" />
        </label>
        <label className="field">
          <span>المادة</span>
          <input list="subjects" maxLength={40} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="اختر أو اكتب اسم المادة" />
          <datalist id="subjects">
            {SUBJECTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <fieldset className="field">
          <legend>لون الغلاف</legend>
          <div className="swatches">
            {HUES.map((h) => (
              <label key={h.id} data-hue={h.id} title={h.label}>
                <input type="radio" name="hue" checked={hue === h.id} onChange={() => setHue(h.id)} aria-label={h.label} />
                <span />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>
            الكتب <small className="muted">اختياري، ويمكنك إضافتها لاحقاً</small>
          </legend>
          <PdfPicker onAdded={(ids) => setBookIds((b) => [...new Set([...b, ...ids])])} />
          {books.length > 0 && <BookChecklist books={books} selected={bookIds} onChange={setBookIds} />}
        </fieldset>
        <div className="dialog-actions">
          <button className="btn btn-primary">{notebook ? 'حفظ التعديل' : 'إنشاء الدفتر'}</button>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </Dialog>
  )
}
