import { AIError } from './types'

const IDLE_MS = 30_000

/** يقرأ بث OpenAI المتوافق. البث المقطوع قبل نهايته يُعد فشلاً كي ينتقل المدير لمزود آخر. */
export async function* readSse(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new AIError('server')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let finished = false
  let length = false
  let any = false
  let think = false
  let held = ''
  // نماذج الاستدلال قد تضع تفكيرها داخل <think>
  const visible = (chunk: string) => {
    held += chunk
    let out = ''
    for (;;) {
      const tag = think ? '</think>' : '<think>'
      const at = held.indexOf(tag)
      if (at >= 0) {
        if (!think) out += held.slice(0, at)
        held = held.slice(at + tag.length)
        think = !think
        continue
      }
      let keep = 0
      for (let k = Math.min(tag.length - 1, held.length); k > 0; k--)
        if (tag.startsWith(held.slice(-k))) {
          keep = k
          break
        }
      if (!think) out += held.slice(0, held.length - keep)
      held = keep ? held.slice(-keep) : ''
      return out
    }
  }
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const idle = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new AIError('timeout')), IDLE_MS)
      })
      const { done, value } = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer))
      buf += done ? dec.decode() : dec.decode(value, { stream: true })
      const lines = buf.split(/\r?\n/)
      buf = done ? '' : lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          finished = true
          continue
        }
        let j
        try {
          j = JSON.parse(data)
        } catch {
          continue
        }
        if (j.error) throw new AIError(j.error.code === 429 ? 'rate' : 'server')
        const c = j.choices?.[0]
        if (typeof c?.delta?.content === 'string') {
          const t = visible(c.delta.content)
          if (t) {
            any ||= t.trim().length > 0
            yield t
          }
        }
        if (c?.finish_reason) {
          finished = true
          length = c.finish_reason === 'length'
        }
      }
      if (done) break
    }
    if (held && !think) yield held
    if (!finished || !any) throw new AIError('server')
    if (length) yield '\n\nتوقفت الإجابة عند الحد الأقصى للطول. اطلب إكمالها إن أردت.'
  } catch (e) {
    if (e instanceof AIError || (e as Error).name === 'AbortError') throw e
    throw new AIError('network')
  } finally {
    void reader.cancel().catch(() => {})
  }
}
