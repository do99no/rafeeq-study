import { tokens } from '../../lib/arabic'
import { getState } from '../../store/store'
import { embed, embedBatch, getAI, hasTask, rerank, Unavailable } from '../ai/manager'
import { getChunks, getVectors, putVectors } from '../books/db'
import { getDocs } from '../books/process'
import type { Chunk, VectorRec } from '../books/types'
import type { Hit, Scope } from './types'

interface Index {
  chunks: Chunk[]
  tf: Map<string, number>[]
  len: number[]
}
const cache = new Map<string, Promise<Index>>()

/** مفتاح الذاكرة يشمل حالة الكتاب كي تُعاد القراءة بعد كل فهرسة */
function index(id: string): Promise<Index> {
  const d = getDocs()[id]
  const key = `${id}:${d?.chunkCount ?? 0}:${d?.ocrPages ?? 0}:${d?.textPages ?? 0}`
  let p = cache.get(key)
  if (!p) {
    for (const k of cache.keys()) if (k.startsWith(`${id}:`)) cache.delete(k)
    p = getChunks(id).then((chunks) => {
      const toks = chunks.map((c) => tokens(`${c.lesson ?? c.chapter ?? ''} ${c.text}`))
      const tf = toks.map((ts) => {
        const m = new Map<string, number>()
        for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1)
        return m
      })
      return { chunks, tf, len: toks.map((t) => t.length) }
    })
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

/** كلمات صياغة الطلب لا تدل على محتوى الكتاب */
const ASK_WORDS = new Set(tokens('اشرح شرح مبسط بسيط بسط بأسلوب اسلوب أبسط مثال أمثلة تفصيل بالتفصيل لخص ملخص قارن عدد علل فسر اكتب أريد ممكن فضلك الدرس الكتاب الفرق معنى تعريف وضح خطوة'))

const titleOf = (id: string) => getState().data.books.find((b) => b.id === id)?.title ?? ''
const inScope = (c: Chunk, s: Scope) => !s.pages || (c.bookId === s.pages.bookId && c.page >= s.pages.from && c.page <= s.pages.to)

/** كل مقاطع النطاق بترتيب الكتاب */
export async function scopeChunks(scope: Scope): Promise<Hit[]> {
  const ids = scope.pages ? [scope.pages.bookId] : scope.bookIds
  const lists = await Promise.all(ids.map((id) => index(id)))
  return lists.flatMap((l) => l.chunks.filter((c) => inScope(c, scope)).map((c) => ({ ...c, bookTitle: titleOf(c.bookId), score: 0 })))
}

/** BM25 على كل كتب النطاق معاً */
export async function textSearch(query: string, scope: Scope, limit = 20): Promise<{ hits: Hit[]; coverage: number }> {
  const q = [...new Set(tokens(query))].filter((t) => !ASK_WORDS.has(t))
  if (!q.length) return { hits: [], coverage: 0 }
  const ids = scope.pages ? [scope.pages.bookId] : scope.bookIds
  const all = (await Promise.all(ids.map(index))).flatMap((ix) => ix.chunks.map((c, i) => ({ c, tf: ix.tf[i], len: ix.len[i] }))).filter((x) => inScope(x.c, scope))
  if (!all.length) return { hits: [], coverage: 0 }
  const avg = all.reduce((s, x) => s + x.len, 0) / all.length || 1
  const df = new Map(q.map((t) => [t, all.filter((x) => x.tf.has(t)).length]))
  const idf = (t: string) => Math.log(1 + (all.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
  const total = q.reduce((s, t) => s + idf(t), 0)
  const scored = all
    .map((x) => {
      let score = 0
      let got = 0
      for (const t of q) {
        const f = x.tf.get(t)
        if (!f) continue
        got += idf(t)
        score += (idf(t) * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * x.len) / avg))
      }
      return { x, score, cov: got / total }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  return {
    hits: scored.slice(0, limit).map(({ x, score }) => ({ ...x.c, bookTitle: titleOf(x.c.bookId), score })),
    coverage: scored.reduce((m, s) => Math.max(m, s.cov), 0),
  }
}

const unit = (v: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s) || 1
  return Float32Array.from(v, (x) => x / n)
}

async function vectorSearch(query: string, scope: Scope, signal: AbortSignal, limit = 20): Promise<Hit[]> {
  const ids = scope.pages ? [scope.pages.bookId] : scope.bookIds
  const recs = (await Promise.all(ids.map(getVectors))).filter((v): v is VectorRec => !!v && v.done > 0)
  const out: Hit[] = []
  for (const model of new Set(recs.map((r) => r.model))) {
    const r = await embed([query], signal, model).catch((e) => {
      if (signal.aborted) throw e
      return null
    })
    if (!r) continue
    const q = unit(r.vectors[0])
    for (const rec of recs.filter((x) => x.model === model && x.dims === q.length)) {
      const { chunks } = await index(rec.bookId)
      for (let i = 0; i < Math.min(rec.done, chunks.length); i++) {
        if (!inScope(chunks[i], scope)) continue
        let s = 0
        for (let k = 0; k < rec.dims; k++) s += q[k] * rec.data[i * rec.dims + k]
        out.push({ ...chunks[i], bookTitle: titleOf(rec.bookId), score: s })
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

const idOf = (c: Chunk) => `${c.bookId}#${c.i}`

/** بحث هجين: نصي + دلالي بدمج الرتب، ثم إعادة ترتيب عند توفرها، مع تمثيل كل كتاب ذي صلة. */
export async function search(query: string, scope: Scope, signal: AbortSignal, limit = 8): Promise<{ hits: Hit[]; semantic: boolean }> {
  const [text, vec] = await Promise.all([textSearch(query, scope), vectorSearch(query, scope, signal)])
  // كلمات السؤال المهمة غائبة عن الكتب والبحث الدلالي غير متاح: لا نمرر مقاطع عشوائية
  if (!vec.length && text.coverage < 0.34) return { hits: [], semantic: false }
  const fused = new Map<string, Hit>()
  for (const list of [text.hits, vec])
    list.forEach((h, r) => {
      const prev = fused.get(idOf(h))
      fused.set(idOf(h), { ...h, score: (prev?.score ?? 0) + 1 / (60 + r) })
    })
  let hits = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, 24)
  if (hits.length > limit && hasTask('rerank')) {
    const order = await rerank(query, hits.map((h) => h.text), signal)
    if (order) hits = order.map((i) => hits[i])
  }
  const top = hits.slice(0, limit)
  if (!scope.pages)
    for (const id of scope.bookIds) {
      if (top.some((h) => h.bookId === id)) continue
      const best = hits.find((h) => h.bookId === id)
      if (best && hits.indexOf(best) < limit * 2) top[top.length - 1] = best
    }
  return { hits: [...new Map(top.map((h) => [idOf(h), h])).values()], semantic: vec.length > 0 }
}

export async function chunksByRef(refs: { bookId: string; i: number }[]): Promise<Hit[]> {
  const out: Hit[] = []
  for (const r of refs) {
    const c = (await index(r.bookId)).chunks[r.i]
    if (c) out.push({ ...c, bookTitle: titleOf(c.bookId), score: 0 })
  }
  return out
}

/** يبني المتجهات تدريجياً ويكمل من حيث توقف. يحترم مدة الانتظار ولا يبدّل النموذج في منتصف الكتاب. */
const embedding = new Set<string>()
export async function buildVectors(bookId: string, signal: AbortSignal): Promise<void> {
  if (embedding.has(bookId) || getAI().service.state === 'unset') return
  embedding.add(bookId)
  try {
    const lock = <T,>(fn: () => Promise<T>) => (navigator.locks ? navigator.locks.request(`rafeeq-embed-${bookId}`, fn) : fn())
    await lock(async () => {
      const { chunks } = await index(bookId)
      let rec = await getVectors(bookId)
      let waits = 0
      while (!signal.aborted && (rec?.done ?? 0) < chunks.length) {
        const from: number = rec?.done ?? 0
        const n = embedBatch()
        try {
          const r = await embed(chunks.slice(from, from + n).map((c) => `${c.lesson ?? c.chapter ?? ''}\n${c.text}`.trim().slice(0, 4000)), signal, rec?.model)
          const dims = r.vectors[0].length
          const data: Float32Array = rec?.data ?? new Float32Array(chunks.length * dims)
          r.vectors.forEach((v, k) => data.set(unit(v), (from + k) * dims))
          rec = { bookId, model: r.model, dims, done: from + r.vectors.length, data }
          await putVectors(rec)
          waits = 0
        } catch (e) {
          const until = e instanceof Unavailable ? e.until : undefined
          const ms = until ? until - Date.now() : 0
          if (signal.aborted || !until || ms > 90_000 || ++waits > 5) return
          await new Promise((res) => setTimeout(res, ms + 500))
        }
      }
    })
  } finally {
    embedding.delete(bookId)
  }
}
