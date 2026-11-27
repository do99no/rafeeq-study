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
  /** الدرس أو الصفحات التي يدرسها الطالب الآن في هذا الدفتر */
  focus?: Focus
  /** المحادثة الحالية؛ القديمة محفوظة في chats. الغياب يعني المحادثة الأولى (معرّفها معرّف الدفتر). */
  chatId?: string
  chats?: ChatInfo[]
  /** الدرس الذي تخصه المحادثة الحالية */
  chatLesson?: string
}

/** نطاق الدراسة: درس من الفهرس أو صفحات PDF محددة */
export interface Focus {
  bookId: string
  from: number
  to: number
  title: string
  sectionId?: string
}
export interface ChatInfo {
  id: string
  title: string
  at: number
  /** الدرس الذي تخصه المحادثة (bookId#sectionId) */
  lesson?: string
}
export type Level = 'simple' | 'normal' | 'deep'

/** بطاقة الكتاب في مكتبة الطالب. حالة المعالجة محفوظة في DocMeta. */
export interface Book {
  id: string
  title: string
  kind: 'pdf'
  sizeBytes: number
  addedAt: number
  subject?: string
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
  /** نوع الرد التعليمي، للعرض والمتابعة */
  task?: Task
  /** سؤال فهم ينتظر إجابة الطالب */
  check?: Check
  /** نتيجة تصحيح إجابة الطالب عن سؤال الفهم */
  verdict?: Verdict
  /** جزء من شرح درس طويل: k من n */
  part?: { k: number; n: number }
  /** حُوِّلت إلى ملخص أو بطاقات… محفوظة */
  savedAs?: string
  /** صفحات قُرئت من صورها، وصفحات لم يطّلع عليها رفيق (بلا نص، أو سقطت منها معادلات ورسوم) */
  pages?: { seen: PageRef[]; unread: PageRef[]; partial: PageRef[] }
}
export interface PageRef {
  bookId: string
  page: number
}
export type Task = 'answer' | 'explain' | 'teach' | 'summary' | 'points' | 'mistakes' | 'examples' | 'steps' | 'compare' | 'check' | 'grade' | 'terms' | 'search'
export type Verdict = 'correct' | 'partial' | 'wrong' | 'skipped'
export interface Check {
  q: string
  answer: string
  options?: string[]
  cite?: Citation
  /** أُجيب عنه أو تُخطي */
  closed?: boolean
}

export type QuestionType = 'mcq' | 'tf' | 'fill' | 'short' | 'reason' | 'essay' | 'problem'
export interface QuizQuestion {
  type: QuestionType
  q: string
  options?: string[]
  /** نص الإجابة؛ في الاختيار يطابق أحد الخيارات */
  answer: string
  why: string
  cite: Citation
  /** مصدر السؤال إن لم يكن من إعداد رفيق (مثل: مذكرة، نموذج امتحان من الكتاب) */
  origin?: string
  /** مهمة صفحة كاملة من نموذج امتحان: يجيب الطالب عن أسئلة الصفحة، ويُصحَّح بصورتها */
  pageTask?: boolean
  /** صفحة في ملف خارجي (مصدر حكومي لا يُعاد نشره): تُفتح برابطها، ولا تصحيح آلي لها */
  link?: string
  /** الإجابة لم تثبت بالتحقق المستقل: تُعرض مع تنبيه بأنها تحتاج مراجعة */
  flag?: string
}
/** امتحان أو ورقة عمل أو اختبار مختلط من بنك الأسئلة */
export interface ExamMeta {
  mode: 'exam' | 'worksheet' | 'mixed'
  sourceId?: string
  subject?: string
  /** دقائق الحل؛ estimated: ليست من مصدر رسمي */
  minutes?: number
  estimated?: boolean
  marks?: number
  level?: 'easy' | 'medium' | 'hard'
  lessons?: string[]
}
export type CardType = 'term' | 'question' | 'law' | 'fact' | 'example'
export interface Flashcard {
  id: string
  front: string
  back: string
  /** البطاقة اليدوية قد تكون بلا مرجع */
  cite?: Citation
  type?: CardType
  extra?: string
  example?: string
  /** صندوق التكرار المتباعد 0..5، والموعد التالي */
  box?: number
  due?: number
  hard?: boolean
  manual?: boolean
  /** لم يثبت بالتحقق المستقل */
  flag?: string
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
  | { kind: 'quiz'; questions: QuizQuestion[]; meta?: ExamMeta }
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
  results?: boolean[]
}

/** خطأ في سؤال: يُستخدم لتحديد ما يحتاج إلى مراجعة */
export interface Mistake {
  id: string
  bookId: string
  bookTitle: string
  page: number
  /** الدرس أو الفصل، أو عنوان نطاق الدراسة */
  topic: string
  q: string
  answer: string
  given?: string
  at: number
  source: 'quiz' | 'chat'
  notebookId?: string
  resolved?: boolean
}
/** ما درسه الطالب: يُحدَّث عند الشرح أو التعليم خطوة بخطوة أو الاختبار */
export interface Studied {
  key: string
  bookId: string
  title: string
  from: number
  to: number
  notebookId: string
  explained?: number
  taught?: { k: number; n: number }
  checks?: { right: number; total: number }
  at: number
}

export interface Settings {
  theme: 'light' | 'dark' | 'auto'
  textSize: 'normal' | 'large'
  digits: 'arab' | 'latn'
  level: Level
  /** موعد الامتحان الذي حدده الطالب (إن لم يحدده المسؤول)، والوقت اليومي */
  examDate?: string
  dailyMin?: number
  /** القراءة الصوتية: الصوت المختار وسرعته */
  voice?: string
  rate?: number
}

/** كل ما يخص طالباً واحداً. يُخزَّن منفصلاً عن الطالب الآخر. */
export interface StudentData {
  notebooks: Notebook[]
  books: Book[]
  messages: Record<string, Message[]>
  outputs: StudyOutput[]
  attempts: QuizAttempt[]
  settings: Settings
  studied: Record<string, Studied>
  mistakes: Mistake[]
}

export interface Profile {
  id: string
  name: string
}
