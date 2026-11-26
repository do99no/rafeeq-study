import type { Chunk, DocMeta, PageRec, VectorRec } from './types'

/**
 * مخزن الكتب في IndexedDB. الملف وفهرسه مشتركان على الجهاز (يُعالَج مرة واحدة)،
 * أما بيانات كل طالب فتبقى منفصلة في التخزين المحلي.
 */
let dbPromise: Promise<IDBDatabase> | undefined

function db() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('rafeeq-files', 2)
    r.onupgradeneeded = () => {
      const d = r.result
      const has = (n: string) => d.objectStoreNames.contains(n)
      if (!has('files')) d.createObjectStore('files') // ملفات المرحلة الأولى
      if (!has('pdfs')) d.createObjectStore('pdfs')
      if (!has('docs')) d.createObjectStore('docs', { keyPath: 'id' })
      if (!has('pages')) d.createObjectStore('pages', { keyPath: ['bookId', 'page'] })
      if (!has('chunks')) d.createObjectStore('chunks', { keyPath: ['bookId', 'i'] })
      if (!has('vectors')) d.createObjectStore('vectors', { keyPath: 'bookId' })
    }
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close()
        dbPromise = undefined
      }
      resolve(r.result)
    }
    r.onerror = () => reject(r.error)
  }).catch((e) => {
    dbPromise = undefined
    throw e
  })
  return dbPromise
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const t = (await db()).transaction(stores, mode)
  const req = fn(t)
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve((req ? req.result : undefined) as T)
    t.onerror = t.onabort = () => reject(t.error)
  })
}
const ofBook = (id: string) => IDBKeyRange.bound([id], [id, []])

export const putPdf = (id: string, file: Blob) => tx(['pdfs'], 'readwrite', (t) => t.objectStore('pdfs').put(file, id))
export async function getPdf(id: string, profileId: string): Promise<Blob | undefined> {
  const blob = await tx<Blob | undefined>(['pdfs'], 'readonly', (t) => t.objectStore('pdfs').get(id))
  return blob ?? tx<Blob | undefined>(['files'], 'readonly', (t) => t.objectStore('files').get(`${profileId}/${id}`))
}
export const hasPdf = (id: string) => tx<number>(['pdfs'], 'readonly', (t) => t.objectStore('pdfs').count(id)).then((n) => n > 0)
export const allDocs = () => tx<DocMeta[]>(['docs'], 'readonly', (t) => t.objectStore('docs').getAll())
export const putDoc = (d: DocMeta) => tx(['docs'], 'readwrite', (t) => t.objectStore('docs').put(d))
export const putPage = (p: PageRec) => tx(['pages'], 'readwrite', (t) => t.objectStore('pages').put(p))
export const putPages = (list: PageRec[]) =>
  tx(['pages'], 'readwrite', (t) => list.forEach((p) => t.objectStore('pages').put(p)))
export const getPages = (id: string) => tx<PageRec[]>(['pages'], 'readonly', (t) => t.objectStore('pages').getAll(ofBook(id)))
export const getChunks = (id: string) => tx<Chunk[]>(['chunks'], 'readonly', (t) => t.objectStore('chunks').getAll(ofBook(id)))
/** استبدال المقاطع يبطل متجهاتها القديمة */
export const replaceChunks = (id: string, list: Chunk[]) =>
  tx(['chunks', 'vectors'], 'readwrite', (t) => {
    const s = t.objectStore('chunks')
    s.delete(ofBook(id))
    t.objectStore('vectors').delete(id)
    list.forEach((c) => s.put(c))
  })
export const getVectors = (id: string) => tx<VectorRec | undefined>(['vectors'], 'readonly', (t) => t.objectStore('vectors').get(id))
export const deleteVectors = (id: string) => tx(['vectors'], 'readwrite', (t) => t.objectStore('vectors').delete(id))
export const putVectors = (v: VectorRec) => tx(['vectors'], 'readwrite', (t) => t.objectStore('vectors').put(v))
export const deleteDoc = (id: string) =>
  tx(['pdfs', 'docs', 'pages', 'chunks', 'vectors'], 'readwrite', (t) => {
    t.objectStore('pdfs').delete(id)
    t.objectStore('docs').delete(id)
    t.objectStore('vectors').delete(id)
    t.objectStore('pages').delete(ofBook(id))
    t.objectStore('chunks').delete(ofBook(id))
  })
