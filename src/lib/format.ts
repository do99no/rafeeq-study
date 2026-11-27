import { getState } from '../store/store'

const locale = () => `ar-EG-u-nu-${getState().data.settings.digits}`

export const num = (n: number) => n.toLocaleString(locale())

/** تمييز العدد: مصدر واحد، مصدران، ٣ مصادر، ١١ مصدراً */
function plural(n: number, zero: string, one: string, two: string, few: string, many: string, base: string) {
  if (n === 0) return zero
  if (n === 1) return one
  if (n === 2) return two
  const r = n % 100
  return `${num(n)} ${r >= 3 && r <= 10 ? few : r >= 11 ? many : base}`
}

export const booksCount = (n: number) => plural(n, 'بلا مصادر', 'مصدر واحد', 'مصدران', 'مصادر', 'مصدراً', 'مصدر')
export const cardsCount = (n: number) => plural(n, 'بلا بطاقات', 'بطاقة واحدة', 'بطاقتان', 'بطاقات', 'بطاقة', 'بطاقة')
export const questionsCount = (n: number) => plural(n, 'بلا أسئلة', 'سؤال واحد', 'سؤالان', 'أسئلة', 'سؤالاً', 'سؤال')
export const lessonsCount = (n: number) => plural(n, 'بلا دروس', 'درس واحد', 'درسان', 'دروس', 'درساً', 'درس')

export function ago(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000)
  const a = Math.abs(s)
  if (a < 60) return 'الآن'
  const f = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  if (a < 3600) return f.format(Math.round(s / 60), 'minute')
  if (a < 86400) return f.format(Math.round(s / 3600), 'hour')
  if (a < 2592000) return f.format(Math.round(s / 86400), 'day')
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
}

export function fileSize(b: number) {
  if (b < 1_048_576) return `${num(Math.max(1, Math.round(b / 1024)))} ك.ب`
  return `${num(Math.round(b / 104857.6) / 10)} م.ب`
}

export { normalize } from './arabic'
