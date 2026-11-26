import type { Chunk } from '../books/types'

/** نطاق البحث: كتب محددة، وقد يقتصر على درس أو صفحات داخل كتاب واحد. */
export interface Scope {
  bookIds: string[]
  pages?: { bookId: string; from: number; to: number }
}
export interface Hit extends Chunk {
  bookTitle: string
  score: number
}
