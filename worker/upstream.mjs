/** الاتصال بالمزود وتصنيف أخطائه: مشترك بين المسار المباشر والمجموعة المشتركة */
import { HttpError } from './http.mjs'

const FIRST_BYTE_MS = 40_000


export const retryAfter = (res, body) => {
  const h = res.headers.get('retry-after')
  if (h) {
    const s = Number(h)
    const v = Number.isFinite(s) ? s : (Date.parse(h) - Date.now()) / 1000
    if (v > 0) return Math.ceil(v)
  }
  const m = body.match(/retryDelay"?\s*:\s*"?([\d.]+)s/) ?? body.match(/try again in ([\d.]+)\s*s/i)
  return m ? Math.ceil(Number(m[1])) : undefined
}

/** تصنيف الخطأ: كل نوع يعالجه المدير بطريقة مختلفة */
export function classify(status, body) {
  const b = body.toLowerCase()
  if (status === 401 || status === 403 || (status === 400 && /api[ _]key (not valid|expired|invalid)|api_key_invalid/.test(b))) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return /per ?day|daily|rpd|tokens per month|insufficient|neurons|free-models-per-day/.test(b) ? 'quota' : 'rate'
  if (status === 413 || /context.{0,20}(length|window)|too many tokens|maximum context/.test(b)) return 'too_large'
  if (status === 404 || status === 410 || /model.{0,60}(not found|does not exist|decommission|deprecated|not supported)/.test(b)) return 'model'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'server'
  return 'bad_request'
}

export async function upstream(url, key, body, signal) {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, FIRST_BYTE_MS)
  const stop = () => ctrl.abort()
  signal?.addEventListener('abort', stop)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch {
    throw new HttpError(502, timedOut ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 4000)
    // لا نمرر نص الخطأ الأصلي: قد يحتوي معلومات الحساب
    throw new HttpError(502, classify(res.status, text), { upstream: res.status, retryAfter: retryAfter(res, text) })
  }
  return res
}
