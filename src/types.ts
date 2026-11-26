export type Hue = 'violet' | 'teal' | 'plum' | 'indigo' | 'olive' | 'clay'

export interface Notebook {
  id: string
  title: string
  subject: string
  hue: Hue
  favorite: boolean
  bookIds: string[]
  createdAt: number
  lastOpenedAt: number
}

/** بطاقة الكتاب في مكتبة الطالب. حالة المعالجة محفوظة في DocMeta. */
export interface Book {
  id: string
  title: string
  kind: 'pdf'
  sizeBytes: number
  addedAt: number
}

export interface Citation {
  n: number
  bookId: string
  bookTitle: string
  /** رقم صفحة PDF الفعلي */
  page: number
  /** الرقم المطبوع إن ثبت */
  printed?: string
  section?: string
  quote: string
  /** النص من التعرف الضوئي: قد تخطئ الرموز */
  ocr?: boolean
  /** في الصفحة معادلات أو رموز لم تُقرأ */
  weak?: boolean
  chunk: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]
  /** المقاطع التي أُعطيت للنموذج: تُستخدم في أسئلة المتابعة */
  basis?: { bookId: string; i: number }[]
  /** search: نتائج بحث نصي دون ذكاء اصطناعي */
  mode?: 'ai' | 'search' | 'none'
  provider?: string
  createdAt: number
}

export type QuestionType = 'mcq' | 'tf' | 'fill' | 'short' | 'essay' | 'problem'
export interface QuizQuestion {
  type: QuestionType
  q: string
  options?: string[]
  /** نص الإجابة؛ في الاختيار يطابق أحد الخيارات */
  answer: string
  why: string
  cite: Citation
}
export interface Flashcard {
  id: string
  front: string
  back: string
  cite: Citation
}
export interface MindNode {
  label: string
  cite?: Citation
  children?: MindNode[]
}

export type OutputData =
  | { kind: 'summary'; text: string; citations: Citation[] }
  | { kind: 'compare'; text: string; citations: Citation[] }
  | { kind: 'note'; text: string; citations: Citation[] }
  | { kind: 'quiz'; questions: QuizQuestion[] }
  | { kind: 'cards'; cards: Flashcard[]; known: string[] }
  | { kind: 'mindmap'; root: MindNode }
export type OutputKind = OutputData['kind']

export interface StudyOutput {
  id: string
  notebookId: string
  title: string
  createdAt: number
  data: OutputData
}

export interface QuizAttempt {
  id: string
  outputId: string
  score: number
  total: number
  at: number
}

export interface Settings {
  theme: 'light' | 'dark' | 'auto'
  textSize: 'normal' | 'large'
  digits: 'arab' | 'latn'
}

/** كل ما يخص طالباً واحداً. يُخزَّن منفصلاً عن الطالب الآخر. */
export interface StudentData {
  notebooks: Notebook[]
  books: Book[]
  messages: Record<string, Message[]>
  outputs: StudyOutput[]
  attempts: QuizAttempt[]
  settings: Settings
}

export interface Profile {
  id: string
  name: string
}
