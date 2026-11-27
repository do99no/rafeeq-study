import { importPack } from '../../lib/books'
import { actions, getState } from '../../store/store'
import { load, save } from '../storage/local'
import { deleteVectors, hasPdf } from './db'
import { getDocs, restoreDoc } from './process'

/** مكتبة المنهج: حزم مشفرة (AES-256-GCM) على الموقع، لا تُفتح إلا برمز المكتبة. */
export interface LibraryItem {
  id: string
  title: string
  subject: string
  file: string
  size: number
  pages: number
  chunks: number
  /** نسخة الفهرس وملفه الصغير المنفصل عن PDF */
  v?: string
  idx?: string
  idxSize?: number
}
const url = (f: string) => new URL(`library/${f}`, document.baseURI).href

/** الرمز يُحفظ على هذا الجهاز فقط */
export const savedCode = () => load<string>('library-code') ?? ''
export const normalCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')

let keyFor: { code: string; key: CryptoKey } | undefined
async function getKey(code: string) {
  if (keyFor?.code === code) return keyFor.key
  const res = await fetch(url('info.json'))
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('none')
  const info = (await res.json()) as { salt: string; rounds: number }
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
  const salt = Uint8Array.from(atob(info.salt), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: info.rounds }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  keyFor = { code, key }
  return key
}
async function unseal(code: string, buf: ArrayBuffer) {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await getKey(code), buf.slice(12))
  } catch (e) {
    if (e instanceof Error && e.message === 'none') throw e
    throw new Error('code')
  }
}

/** none: لا مكتبة منشورة، code: رمز غير صحيح، network: تعذر التنزيل */
export async function openLibrary(code: string): Promise<LibraryItem[]> {
  await getKey(code)
  const res = await fetch(url('manifest.bin'), { cache: 'no-cache' })
  if (!res.ok) throw new Error('network')
  const items = JSON.parse(new TextDecoder().decode(await unseal(code, await res.arrayBuffer())))
  save('library-code', code)
  return items
}

export async function downloadBook(code: string, item: LibraryItem, onProgress: (p: number) => void) {
  const res = await fetch(url(item.file))
  if (!res.ok || !res.body) throw new Error('network')
  const reader = res.body.getReader()
  const parts: BlobPart[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onProgress(Math.min(1, got / item.size))
  }
  const book = await importPack(new File([await unseal(code, await new Blob(parts).arrayBuffer())], `${item.title}.rafeeq`))
  // ملف PDF المشفر قد يسبق آخر تحديث للفهرس: يُكمَّل بالملف الصغير
  if (item.v && getDocs()[item.id]?.v !== item.v) await updateIndex(code, item).catch(() => false)
  return { ...book, subject: item.subject }
}

/** يحدّث فهرس كتاب منزّل (الدروس والمقاطع) دون إعادة تنزيل PDF */
async function updateIndex(code: string, item: LibraryItem) {
  if (!item.idx || !(await hasPdf(item.id))) return false
  const res = await fetch(url(item.idx))
  if (!res.ok) return false
  const plain = await unseal(code, await res.arrayBuffer())
  const json = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
  const { meta, pages, chunks } = json
  if (meta?.id !== item.id || !Array.isArray(pages) || !Array.isArray(chunks) || !chunks.every((c: { bookId?: string }) => c.bookId === item.id)) return false
  // ترتيب المقاطع قد تغيّر، فالمتجهات القديمة لم تعد صالحة
  await deleteVectors(item.id).catch(() => {})
  await restoreDoc(meta, pages, chunks)
  return true
}

/** فهارس دروس الكتب كلها من ملفات الفهرس الصغيرة (دون تنزيل الكتب)، لاختيار دروس الخطة */
export async function lessonCatalog(code: string) {
  const items = await openLibrary(code)
  return Promise.all(
    items.map(async (item) => {
      let sections: { id: string; title: string; level: 1 | 2; page: number; endPage: number }[] = []
      if (item.idx) {
        const res = await fetch(url(item.idx))
        if (res.ok) {
          const plain = await unseal(code, await res.arrayBuffer())
          sections = (await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).json()).meta?.sections ?? []
        }
      }
      return { id: item.id, title: item.title, subject: item.subject, sections }
    }),
  )
}

let syncing: Promise<number> | undefined
/** عند فتح التطبيق: يحدّث فهارس الكتب المنزّلة ويكمل مادة كل كتاب. يعيد عدد الكتب المحدَّثة. */
export function syncLibrary(): Promise<number> {
  syncing ??= (async () => {
    const code = savedCode()
    if (!code) return 0
    let items: LibraryItem[]
    try {
      items = await openLibrary(code)
    } catch {
      return 0
    }
    let n = 0
    for (const item of items) {
      const book = getState().data.books.find((b) => b.id === item.id)
      if (book && !book.subject && item.subject) actions.setBookSubject(item.id, item.subject)
      const d = getDocs()[item.id]
      if (d && item.v && d.v !== item.v && (await updateIndex(code, item).catch(() => false))) n++
    }
    return n
  })().finally(() => (syncing = undefined))
  return syncing
}
