export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** صور صفحات الكتاب (data:image/jpeg) لمزود يقرأ الصور */
  images?: string[]
  /** تعليمات تُضاف إلى النص فقط إذا أُرسلت الصور فعلاً */
  imagesNote?: string
}

/** المهام مفصولة: لا يُستخدم مزود إلا في مهمة يعلن دعمها */
export type Task = 'chat' | 'embed' | 'rerank' | 'vision' | 'stt' | 'tts'
export const TASK_LABEL: Record<Task, string> = {
  chat: 'الإجابة', embed: 'البحث الدلالي', rerank: 'ترتيب النتائج', vision: 'الصور', stt: 'تحويل الصوت', tts: 'القراءة الصوتية',
}

export type ErrorCode =
  | 'auth' | 'quota' | 'rate' | 'too_large' | 'model' | 'timeout' | 'server' | 'network' | 'bad_request' | 'not_configured'
  /** تخص الوسيط نفسه لا المزود */
  | 'access' | 'worker_setup' | 'worker_down' | 'worker_url'

export class AIError extends Error {
  constructor(public code: ErrorCode, public retryAfter?: number) {
    super(code)
  }
}

export interface ProviderInfo {
  id: string
  name: string
  note?: string
  configured: boolean
  models: Partial<Record<Task, string>>
  embedBatch?: number
}

/** عقد المزود. لإضافة مزود: سجّله في worker/providers.mjs، أو نفّذ هذا العقد لمزود محلي. */
export interface Provider {
  info: ProviderInfo
  chat?(messages: ChatMsg[], opts: { maxTokens?: number; signal: AbortSignal }): AsyncIterable<string>
  embed?(texts: string[], signal: AbortSignal): Promise<{ model: string; vectors: number[][] }>
  rerank?(query: string, docs: string[], signal: AbortSignal): Promise<number[]>
}

export interface Health {
  ok?: boolean
  code?: ErrorCode
  /** لا نعيد المحاولة قبل هذا الوقت */
  until?: number
  at?: number
  /** عدد الطلبات الناجحة اليوم من هذا الجهاز */
  day?: string
  used?: number
}
