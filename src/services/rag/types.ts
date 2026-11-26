import type { Chunk } from '../books/types'

/** نطاق البحث: كتب محددة، وقد يقتصر على درس أو صفحات داخل كتاب واحد. */
export interface Scope {
  bookIds: string[]
  pages?: { bookId: string; from: number; to: number }
  /** عدة دروس أو نطاقات صفحات، وقد تكون من كتب مختلفة */
  ranges?: { bookId: string; from: number; to: number }[]
}
export interface Hit extends Chunk {
  bookTitle: string
  score: number
}
