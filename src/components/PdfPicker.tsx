import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { addPdfFiles } from '../lib/books'

/** منطقة إضافة PDF بالسحب أو الاختيار. */
export function PdfPicker({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const add = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    const ids = await addPdfFiles([...list])
    setBusy(false)
    if (ids.length) onAdded?.(ids)
  }
  return (
    <>
      <button
        type="button"
        className={over ? 'dropzone is-over' : 'dropzone'}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void add(e.dataTransfer.files)
        }}
      >
        <FileUp aria-hidden="true" />
        <span>
          <strong>{busy ? 'جارٍ الحفظ…' : 'اختر ملفات PDF أو حزم الكتب'}</strong>
          <small>أو اسحبها إلى هنا</small>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,.rafeeq"
        multiple
        hidden
        onChange={(e) => {
          void add(e.target.files).then(() => {
            if (input.current) input.current.value = ''
          })
        }}
      />
    </>
  )
}
