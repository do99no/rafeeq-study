/** تخزين محلي. كل طالب له مفتاح مستقل. بيانات المرحلة الأولى (v1) تبقى كما هي نسخةً احتياطية. */
const PREFIX = 'rafeeq:v2:'
const OLD = 'rafeeq:v1:'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
export const load = <T>(key: string) => read<T>(PREFIX + key)
export const loadOld = <T>(key: string) => read<T>(OLD + key)

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** مفاتيح بيانات الطلاب فقط؛ إعدادات الذكاء الاصطناعي لا تعيد بناء الحالة */
export const isOurKey = (key: string | null) => key === null || key === `${PREFIX}app` || key.startsWith(`${PREFIX}data:`)
