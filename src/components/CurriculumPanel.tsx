import { useEffect, useState } from 'react'
import { Download, LoaderCircle, LockKeyhole } from 'lucide-react'
import { fileSize, num } from '../lib/format'
import { downloadBook, normalCode, openLibrary, savedCode, type LibraryItem } from '../services/books/library'
import { actions, getState, useData } from '../store/store'
import { useDocs } from '../services/books/process'
import { serverLibraryCode } from '../services/server/account'
import { save } from '../services/storage/local'
import { toast } from '../store/toast'

/** كتب المنهج المشفرة على الموقع: تُنزَّل مرة واحدة إلى هذا الجهاز. */
export function CurriculumPanel() {
  const { books } = useData()
  const [code, setCode] = useState(savedCode)
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'none' | 'code' | 'network'>('idle')
  const [active, setActive] = useState<{ id: string; p: number } | null>(null)

  const unlock = async (c: string) => {
    setState('busy')
    try {
      setItems(await openLibrary(normalCode(c)))
      setState('idle')
    } catch (e) {
      const m = (e as Error).message
      setState(m === 'none' || m === 'code' ? m : 'network')
    }
  }
  useEffect(() => {
    if (savedCode()) return void unlock(savedCode())
    // جهاز جديد: رمز المكتبة من الخادم إن أعدّه المسؤول، دون انتظار
    void serverLibraryCode()
      .then((c) => {
        if (!c) return
        save('library-code', c)
        setCode(c)
        void unlock(c)
      })
      .catch(() => {})
  }, [])

  // «منزّل» يعني أن ملفه وفهرسه على هذا الجهاز، لا أنه في قائمة الطالب المتزامنة من جهاز آخر
  const docs = useDocs()
  const have = new Set(books.filter((b) => docs[b.id]?.chunkCount).map((b) => b.id))
  const missing = items?.filter((i) => !have.has(i.id)) ?? []

  const get = async (list: LibraryItem[]) => {
    const profileId = getState().activeId
    void navigator.storage?.persist?.()
    for (const item of list) {
      setActive({ id: item.id, p: 0 })
      try {
        const book = await downloadBook(normalCode(code), item, (p) => setActive({ id: item.id, p }))
        if (getState().activeId !== profileId) break
        if (!getState().data.books.some((b) => b.id === book.id)) actions.addBook(book)
      } catch {
        toast(`تعذّر تنزيل «${item.title}». تحقق من الاتصال والمساحة ثم حاول مرة أخرى.`)
        break
      }
    }
    setActive(null)
  }

  if (state === 'none' || (items && !missing.length)) return null
  return (
    <section className="panel" aria-labelledby="cur-h">
      <div className="section-head">
        <h2 id="cur-h">كتب المنهج</h2>
        {missing.length > 1 && (
          <button className="btn" disabled={!!active} onClick={() => void get(missing)}>
            <Download aria-hidden="true" /> تنزيل الكل ({fileSize(missing.reduce((s, i) => s + i.size, 0))})
          </button>
        )}
      </div>
      {!items ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) void unlock(code)
          }}
        >
          <label className="field">
            <span>رمز المكتبة</span>
            <input dir="ltr" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" />
          </label>
          {state === 'code' && <p className="form-error" role="alert">الرمز غير صحيح.</p>}
          {state === 'network' && <p className="form-error" role="alert">تعذّر الوصول إلى المكتبة. تحقق من الاتصال.</p>}
          <div>
            <button className="btn btn-primary" disabled={state === 'busy'}>
              {state === 'busy' ? <LoaderCircle className="spin" aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />} فتح المكتبة
            </button>
          </div>
        </form>
      ) : (
        <ul className="curriculum">
          {missing.map((i) => (
            <li key={i.id} className="setting">
              <span className="grow">
                {i.title}
                <small className="muted">
                  {' '}
                  {num(i.pages)} صفحة، {fileSize(i.size)}
                </small>
                {active?.id === i.id && <progress max={1} value={active.p} aria-label={`تنزيل ${i.title}`} />}
              </span>
              <button className="btn btn-sm" disabled={!!active} onClick={() => void get([i])}>
                <Download aria-hidden="true" /> تنزيل
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
