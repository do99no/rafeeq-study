export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code)
    Object.assign(this, { status, body: { code, ...extra } })
  }
}

export const isText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max

/** مقارنة بزمن ثابت */
export async function same(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = [await h(a), await h(b)]
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

export const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
export const sha256 = async (s) => b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
export const randomToken = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)))
