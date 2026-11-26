import { useState } from 'react'
import { actions } from '../../store/store'
import { toast } from '../../store/toast'
import type { StudyOutput } from '../../types'
import { Dialog } from '../Dialog'
import { RichText } from '../RichText'
import { CardsView } from './CardsView'
import { MindMapView } from './MindMapView'
import { QuizView } from './QuizView'

function NoteView({ output, text, onDone }: { output: StudyOutput; text: string; onDone: () => void }) {
  const [title, setTitle] = useState(output.title)
  const [body, setBody] = useState(text)
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        actions.editNote(output.id, title.trim() || 'ملاحظة', body)
        toast('تم حفظ الملاحظة.')
        onDone()
      }}
    >
      <label className="field">
        <span>العنوان</span>
        <input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>الملاحظة</span>
        <textarea className="input note-area" rows={9} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {output.data.kind === 'note' && output.data.citations.length > 0 && <RichText text="" citations={output.data.citations} />}
      <div className="dialog-actions">
        <button className="btn btn-primary">حفظ</button>
      </div>
    </form>
  )
}

export default function OutputDialog({ output, onClose }: { output: StudyOutput; onClose: () => void }) {
  const { data } = output
  return (
    <Dialog variant="wide" title={output.title} onClose={onClose}>
      {(data.kind === 'summary' || data.kind === 'compare') && <RichText text={data.text} citations={data.citations} />}
      {data.kind === 'note' && <NoteView output={output} text={data.text} onDone={onClose} />}
      {data.kind === 'quiz' && <QuizView outputId={output.id} questions={data.questions} />}
      {data.kind === 'cards' && <CardsView outputId={output.id} cards={data.cards} known={data.known} />}
      {data.kind === 'mindmap' && <MindMapView root={data.root} />}
    </Dialog>
  )
}
