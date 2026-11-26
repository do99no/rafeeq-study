export type DocStatus = 'none' | 'extracting' | 'ocr' | 'chunking' | 'indexing' | 'done' | 'review' | 'failed'

export interface Section {
  id: string
  title: string
  level: 1 | 2
  page: number
  endPage: number
}

/** حالة معالجة الكتاب. المعرّف مشتق من محتوى الملف فلا تتكرر المعالجة. */
export interface DocMeta {
  id: string
  status: DocStatus
  reason?: string
  progress?: number
  pageCount: number
  textPages: number
  ocrPages: number
  /** صفحات لا نص فيها أو نصها غير موثوق */
  badPages: number[]
  /** صفحات قُرئ نصها وسقطت منها معادلات أو رموز غير واضحة */
  weakPages?: number[]
  language: 'ar' | 'en' | 'mixed' | 'unknown'
  sections: Section[]
  chunkCount: number
  /** نسخة الفهرس المنشورة، لتحديث الكتاب دون إعادة تنزيله */
  v?: string
}

export interface Line {
  t: string
  h: number
  /** فراغ رأسي قبل السطر */
  gap?: boolean
}
export interface PageRec {
  bookId: string
  page: number
  lines: Line[]
  src: 'text' | 'ocr' | 'none'
  ok: boolean
  weak?: number
  label?: string
}
export interface Chunk {
  bookId: string
  i: number
  page: number
  printed?: string
  sectionId?: string
  chapter?: string
  lesson?: string
  text: string
  ocr?: boolean
  weak?: boolean
}
export interface VectorRec {
  bookId: string
  /** المزود والنموذج معاً: لا تُخلط متجهات نموذجين */
  model: string
  dims: number
  done: number
  data: Float32Array
}
