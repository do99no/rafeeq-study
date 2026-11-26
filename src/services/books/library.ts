import { importPack } from '../../lib/books'
import { load, save } from '../storage/local'

/** مكتبة المنهج: حزم مشفرة (AES-256-GCM) على الموقع، لا تُفتح إلا برمز المكتبة. */
export interface LibraryItem {
  id: string
  title: string
  subject: string
  file: string
  size: number
  pages: number
  chunks: number
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
  return importPack(new File([await unseal(code, await new Blob(parts).arrayBuffer())], `${item.title}.rafeeq`))
}
