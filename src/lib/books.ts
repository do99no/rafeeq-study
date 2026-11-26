import type { Book } from '../types'
import { hasPdf, putPdf } from '../services/books/db'
import { processBook, restoreDoc } from '../services/books/process'
import type { DocMeta, DocStatus } from '../services/books/types'
import { actions, getState } from '../store/store'
import { toast } from '../store/toast'
import { num } from './format'

export const STATUS: Record<DocStatus, string> = {
  none: 'لم تتم معالجته', extracting: 'جارٍ استخراج النص', ocr: 'جارٍ التعرف الضوئي', chunking: 'جارٍ تقسيم المحتوى', indexing: 'جارٍ الفهرسة', done: 'مكتمل', review: 'يحتاج إلى مراجعة', failed: 'فشل',
}
export function statusText(d?: DocMeta) {
  const s = d?.status ?? 'none'
  return (s === 'extracting' || s === 'ocr') && d?.progress ? `${STATUS[s]} ${num(Math.round(d.progress * 100))}٪` : STATUS[s]
}

async function isPdf(file: File) {
  const head = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer())
  return head.includes('%PDF-')
}
async function contentId(file: Blob) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return `bk${[...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** حزمة كتاب جاهزة: رأس مضغوط فيه الصفحات والفهرس، ثم ملف PDF الأصلي. */
export async function importPack(file: File): Promise<Book> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const size = new DataView(head.buffer).getUint32(8)
  if (size > file.size) throw new Error('pack')
  const json = await new Response(file.slice(12, 12 + size).stream().pipeThrough(new DecompressionStream('gzip'))).json()
  const pdf = file.slice(12 + size, file.size, 'application/pdf')
  const { meta, pages, chunks, title } = json
  // الحزمة لا تُقبل إلا إذا طابق المعرّف محتوى PDF نفسه
  if (meta?.id !== (await contentId(pdf)) || !Array.isArray(pages) || !Array.isArray(chunks) || !chunks.every((c) => c.bookId === meta.id)) throw new Error('pack')
  await putPdf(meta.id, pdf)
  await restoreDoc(meta, pages, chunks)
  return { id: meta.id, title: String(title).slice(0, 100), kind: 'pdf', sizeBytes: pdf.size, addedAt: Date.now() }
}
const isPack = async (file: File) => new TextDecoder().decode(await file.slice(0, 8).arrayBuffer()) === 'RAFEEQ01'

/** يحفظ ملفات PDF ويبدأ معالجتها. يعيد معرّفات الكتب. */
export async function addPdfFiles(files: Iterable<File>): Promise<string[]> {
  const profileId = getState().activeId
  const ids: string[] = []
  const problems: string[] = []
  void navigator.storage?.persist?.()
  for (const file of files) {
    try {
      if (await isPack(file)) {
        const book = await importPack(file)
        if (getState().activeId !== profileId) return []
        if (!getState().data.books.some((b) => b.id === book.id)) actions.addBook(book)
        ids.push(book.id)
        continue
      }
      if (!(await isPdf(file))) {
        problems.push(`«${file.name}» ليس ملف PDF أو حزمة كتاب صالحة.`)
        continue
      }
      const id = await contentId(file)
      if (!(await hasPdf(id))) await putPdf(id, file)
      if (getState().activeId !== profileId) return [] // بُدّل الطالب أثناء الحفظ
      const title = file.name.replace(/\.pdf$/i, '')
      if (getState().data.books.some((b) => b.id === id)) problems.push(`«${title}» موجود في مكتبتك.`)
      else {
        const book: Book = { id, title, kind: 'pdf', sizeBytes: file.size, addedAt: Date.now() }
        actions.addBook(book)
      }
      ids.push(id)
      void processBook(id, profileId)
    } catch {
      problems.push(`تعذّر حفظ «${file.name}». تحقق من المساحة المتاحة في المتصفح.`)
    }
  }
  toast(problems[0] ?? (ids.length ? 'تمت إضافة الكتب.' : ''))
  return ids
}
