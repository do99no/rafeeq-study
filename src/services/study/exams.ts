import type { Citation, QuizQuestion, Verdict } from '../../types'
import { normalize } from '../../lib/arabic'
import { chat, visionReady } from '../ai/manager'
import { getDocs } from '../books/process'
import { scopeChunks } from '../rag/search'
import { cleanCites, toCitation } from './assistant'
import { pageImages } from './pages'
import { subjectGuide, STRICT } from './prompts'

/**
 * مصادر الامتحانات والتدريب الموجودة فعلاً في كتب رفيق، فُحصت صفحاتها (2026-11-27).
 * لا امتحان شهادة سابقاً مؤرخاً في أي من الكتب الخمسة عشر؛ ما يلي نماذج وأسئلة بنمط الشهادة فقط، موسومة بما هي عليه.
 * المحتوى نفسه لا يُنشر هنا: يُقرأ من الكتاب المنزّل على جهاز الطالب (المكتبة مشفرة).
 */
export interface ExamSource {
  id: string
  subject: string
  bookId: string
  book: string
  title: string
  kind: 'past' | 'model' | 'style'
  /** الصفحات في PDF */
  from: number
  to: number
  /** pages: يجيب الطالب عن أسئلة كل صفحة؛ mcq: أسئلة اختيار بإجابات المصدر */
  mode: 'pages' | 'mcq'
  origin: string
  /** زمن الامتحان ودرجاته إن نصّ عليها المصدر فقط */
  minutes?: number
  marks?: number
  note?: string
}
export const EXAM_SOURCES: ExamSource[] = [
  {
    id: 'ar-special-model', subject: 'اللغة العربية', bookId: 'bk0998c923703ccb944201447d', book: 'اللغة العربية الخاصة',
    title: 'نموذج امتحان اللغة العربية الخاصة', kind: 'model', from: 200, to: 208, mode: 'pages',
    origin: 'نموذج امتحان من الكتاب المدرسي، وليس امتحان سنة سابقة',
    note: 'يذكر الكتاب أنه على وفق امتحان الشهادة. الزمن غير مدوّن في الصفحة، ولا توزيع الدرجات.',
  },
  {
    id: 'en1-certificate', subject: 'اللغة الإنجليزية', bookId: 'bk19c370d40eb7672e81bf1011', book: 'مذكرة الإنجليزية 1',
    title: 'Sudanese Certificate Examples (الأزمنة الحاضرة)', kind: 'style', from: 15, to: 16, mode: 'mcq',
    origin: 'أسئلة بنمط الشهادة من مذكرة غير رسمية، والإجابة كما في المذكرة',
    note: 'المذكرة لا تذكر سنة امتحان لهذه الأسئلة. الأسئلة نفسها في مذكرة الإنجليزية 2 (ص 15–16).',
  },
  {
    id: 'en2-future', subject: 'اللغة الإنجليزية', bookId: 'bkaf5b5398a7a34310337d3097', book: 'مذكرة الإنجليزية 2 (موسعة)',
    title: 'Sudanese Certificate–Style Questions (المستقبل)', kind: 'style', from: 28, to: 29, mode: 'mcq',
    origin: 'أسئلة بنمط الشهادة من مذكرة غير رسمية، والإجابة كما في المذكرة',
  },
  {
    id: 'en2-passive', subject: 'اللغة الإنجليزية', bookId: 'bkaf5b5398a7a34310337d3097', book: 'مذكرة الإنجليزية 2 (موسعة)',
    title: 'Sudanese Certificate–Style Questions (المبني للمجهول)', kind: 'style', from: 40, to: 40, mode: 'mcq',
    origin: 'أسئلة بنمط الشهادة من مذكرة غير رسمية، والإجابة كما في المذكرة',
  },
]

/**
 * امتحانات منشورة على موقع حكومي سوداني (gmoe.gov.sd، وزارة التربية والتعليم بولاية الجزيرة)، فُحصت (2026-11-27):
 * ترويستها «جمهورية السودان – وزارة التربية والتعليم – مجلس امتحانات السودان – امتحان الشهادة الثانوية – أبريل 2020»،
 * والزمن مطبوع عليها. هي نسخ ممسوحة عليها شعار sudanexams.com. لا يُعاد نشرها لعدم وضوح حقوقها: تُفتح من مصدرها.
 * لا نموذج إجابة رسمياً منشوراً لأي منها.
 */
const GOV = 'https://gmoe.gov.sd/wp-content/uploads/2025/06/'
export interface ExternalPaper {
  id: string
  subject: string
  title: string
  kind: 'past' | 'mock'
  date: string
  issuer: string
  url: string
  pages: number
  minutes: number
  note: string
}
export const EXTERNAL_PAPERS: ExternalPaper[] = [
  ...([
    ['physics', 'الفيزياء', 'الفيزياء-2020.pdf', 8],
    ['math-special', 'الرياضيات', 'المتخصصة-2020.pdf', 8, 'الرياضيات المتخصصة'],
    ['math-basic', 'الرياضيات', 'الاساسية-2020-1.pdf', 6, 'الرياضيات الأساسية'],
    ['biology', 'الأحياء', 'الاحياء-2020-1.pdf', 8],
    ['english', 'اللغة الإنجليزية', 'الانجليزية-2020.pdf', 8],
    ['arabic', 'اللغة العربية', 'اللغة-العربية-2020.pdf', 8],
  ] as [string, string, string, number, string?][]).map(([id, subject, file, pages, name]) => ({
    id: `sd2020-${id}`, subject, title: `امتحان الشهادة الثانوية السودانية: ${name ?? subject} (أبريل 2020)`, kind: 'past' as const, date: 'أبريل 2020',
    issuer: 'مجلس امتحانات السودان (كما في ترويسة الورقة)', url: GOV + encodeURIComponent(file), pages, minutes: 180,
    note: 'من موقع وزارة التربية والتعليم بولاية الجزيرة. الدور غير مذكور. لا نموذج إجابة رسمي منشور.',
  })),
  {
    id: 'gezira-mock-2020-engineering', subject: 'العلوم الهندسية', title: 'امتحان تجريبي للشهادة: العلوم الهندسية (يناير 2020)', kind: 'mock', date: 'يناير 2020',
    issuer: 'وزارة التربية والتعليم، ولاية الجزيرة (امتحان تجريبي، ليس امتحان شهادة)', url: GOV + encodeURIComponent('هندسية-2020.pdf'), pages: 8, minutes: 180,
    note: 'امتحان تجريبي ولائي، وليس امتحان الشهادة الرسمي.',
  },
]
/** دليل امتحان الشهادة الثانوية 2025 (المركز القومي للمناهج): هيكل الامتحان والمقرر لكل مادة، بصفحاته */
export const GUIDE_2025 = {
  url: 'https://gmoe.gov.sd/wp-content/uploads/2025/08/' + encodeURIComponent('دليل-امتحانات-الشهادة-الثانوية-2025م.pdf'),
  issuer: 'وزارة التربية والتعليم، المركز القومي للمناهج والبحث التربوي (بخت الرضا)',
  pages: { 'التربية الإسلامية': 5, 'اللغة العربية': 20, 'اللغة الإنجليزية': 28, 'الرياضيات': 44, 'الكيمياء': 52, 'الفيزياء': 62, 'الأحياء': 91, 'العلوم الهندسية': 116 } as Record<string, number>,
}

/** المواد الثماني: ما وُجد لكل منها وما ينقص */
export const SUBJECTS = ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء', 'العلوم الهندسية', 'اللغة العربية', 'التربية الإسلامية', 'اللغة الإنجليزية']
export function coverage() {
  return SUBJECTS.map((s) => {
    const list = EXAM_SOURCES.filter((x) => x.subject === s)
    const ext = EXTERNAL_PAPERS.filter((x) => x.subject === s)
    return { subject: s, past: ext.filter((x) => x.kind === 'past').length, mock: ext.filter((x) => x.kind === 'mock').length, model: list.filter((x) => x.kind === 'model').length, style: list.filter((x) => x.kind === 'style').length, officialKeys: 0, guide: GUIDE_2025.pages[s] ?? null }
  })
}

/** ورقة خارجية في وضع الامتحان: مهمة لكل صفحة تُفتح من مصدرها، دون تصحيح آلي (لا نموذج إجابة ولا صور لدى رفيق) */
export function externalExam(x: ExternalPaper): QuizQuestion[] {
  return Array.from({ length: x.pages }, (_, i) => ({
    type: 'essay', q: `أجب عن أسئلة الصفحة ${i + 1} من الورقة.`, answer: '', why: '', pageTask: true, link: `${x.url}#page=${i + 1}`, origin: `${x.title}، ${x.issuer}`,
    cite: { n: 1, bookId: '', bookTitle: x.title, page: i + 1, chunk: 0, quote: '' },
  }))
}

/** الدرس الذي تقع فيه صفحة، لربط الخطأ بشرحه في الكتاب */
export function lessonOf(bookId: string, page: number) {
  const secs = getDocs()[bookId]?.sections ?? []
  const inside = secs.filter((s) => s.page <= page && s.endPage >= page)
  return inside.find((s) => s.level === 2) ?? inside[0]
}

/**
 * أسئلة الاختيار بإجاباتها من نص المذكرة نفسه. يُقبل السؤال فقط إذا طابق نص الإجابة المكتوب الخيار الذي يشير إليه حرفه.
 */
export function parseMcq(text: string) {
  const out: { q: string; options: string[]; answer: string }[] = []
  const re = /(?:^|\s)(\d{1,2})\.\s+(.+?)\s+A\.\s+(.+?)\s+B\.\s+(.+?)\s+C\.\s+(.+?)\s+D\.\s+(.+?)\s+(?:✅\s*)?(?:Answer:\s*)?([A-D])\s*[—–-]\s*(.+?)(?=\s+(?:→|Why\b|\d{1,2}\.\s|[؀-ۿ.])|$)/g
  for (const m of text.matchAll(re)) {
    const options = [m[3], m[4], m[5], m[6]].map((s) => s.trim())
    const answer = options['ABCD'.indexOf(m[7])]
    if (!m[8].trim().toLowerCase().startsWith(answer.toLowerCase())) continue
    out.push({ q: m[2].trim(), options, answer })
  }
  return out
}

const cite = (bookId: string, page: number, quote: string, bookTitle: string): Citation => ({ n: 1, bookId, bookTitle, page, chunk: 0, quote: quote.slice(0, 300), ocr: true })

/** يبني أسئلة المصدر من الكتاب المنزّل على هذا الجهاز */
export async function buildExam(src: ExamSource): Promise<QuizQuestion[]> {
  const hits = await scopeChunks({ bookIds: [src.bookId], pages: { bookId: src.bookId, from: src.from, to: src.to } })
  if (!hits.length) throw new Error('not_downloaded')
  if (src.mode === 'mcq') {
    const text = hits.map((h) => h.text).join(' ').replace(/\s+/g, ' ')
    const seen = new Set<string>()
    return parseMcq(text)
      .filter((x) => !seen.has(normalize(x.q)) && seen.add(normalize(x.q)))
      .map((x) => {
        const h = hits.find((c) => c.text.replace(/\s+/g, ' ').includes(x.q.slice(0, 20))) ?? hits[0]
        return { type: 'mcq', q: x.q, options: x.options, answer: x.answer, why: 'الإجابة كما وردت في المذكرة.', cite: { ...toCitation(h, 1), quote: x.q }, origin: src.origin }
      })
  }
  const pages = Array.from({ length: src.to - src.from + 1 }, (_, i) => src.from + i)
  return pages.map((p) => {
    const first = hits.find((h) => h.page === p)
    return { type: 'essay', q: `أجب عن أسئلة الصفحة ${p} من النموذج (افتح الصفحة لترى الأسئلة).`, answer: '', why: '', cite: cite(src.bookId, p, first?.text ?? '', src.book), origin: src.origin, pageTask: true }
  })
}

/**
 * تصحيح إجابات صفحة من نموذج امتحان: النموذج يرى صورة الصفحة الأصلية ونصها. لا نموذج إجابة رسمياً،
 * فالتصحيح مقترح ويُعرض كذلك، ولا يُعطى رقم درجة.
 */
export async function gradePage(bookId: string, page: number, given: string, subject: string | undefined, signal: AbortSignal): Promise<{ verdict: Verdict | 'review'; text: string; topic?: string }> {
  const hits = await scopeChunks({ bookIds: [bookId], pages: { bookId, from: page, to: page } })
  const shots = (await visionReady()) ? await pageImages([{ bookId, page }]) : []
  const passage = hits.map((h) => h.text).join('\n')
  let raw = ''
  for await (const ev of chat(
    [
      { role: 'system', content: `${STRICT}\n${subjectGuide([subject])}` },
      {
        role: 'user',
        content: `صفحة ${page} من نموذج امتحان في الكتاب. نصها المقروء آلياً (قد يكون ناقصاً):\n[1] ${passage}\n\n---\nإجابات الطالب عن أسئلة هذه الصفحة:\n${given}\n\nصحّح إجابات الطالب سؤالاً سؤالاً كما تفهمها من الصفحة. لا يوجد نموذج إجابة رسمي: قدّم ما تراه صحيحاً اعتماداً على الكتاب، ونبّه إلى ما يحتاج تقدير معلم. السطر الأول بالضبط: «الحكم: صحيحة» أو «الحكم: صحيحة جزئياً» أو «الحكم: خاطئة» أو «الحكم: تحتاج مراجعة معلم». السطر الثاني: «الموضوع: …» اسم الدرس أو المهارة. ثم لكل سؤال: الصحيح فيما كتب، والخطأ وسببه، والإجابة المقترحة.`,
        ...(shots.length ? { images: shots.map((s) => s.url), imagesNote: `أُرفقت صورة الصفحة ${page} الأصلية: اقرأ الأسئلة منها.` } : {}),
      },
    ],
    { signal, maxTokens: 3000 },
  ))
    if (ev.type === 'reset') raw = ''
    else if (ev.type === 'text') raw += ev.text
  const lines = raw.trim().split('\n')
  const v = normalize(lines.find((l) => l.includes('الحكم')) ?? '').replace(/ئ/g, 'ي')
  const verdict = /مراجعه|معلم/.test(v) ? 'review' : /جزي/.test(v) ? 'partial' : /خاطي|خاطئ/.test(v) ? 'wrong' : /صحيح/.test(v) ? 'correct' : 'review'
  const topic = lines.find((l) => l.includes('الموضوع'))?.split(/[:：]/).slice(1).join(':').trim()
  const body = lines.filter((l) => !l.includes('الحكم') && !l.startsWith('الموضوع')).join('\n')
  return { verdict, text: cleanCites(body, 1).text, topic }
}
