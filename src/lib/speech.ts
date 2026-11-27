/**
 * القراءة الصوتية: محرك المتصفح نفسه (مجاني، بلا خادم). التحسين هنا في النص المقروء لا في الصوت:
 * - لا تُقرأ رموز التنسيق (#، **، |، >، أرقام الاستشهاد).
 * - الرياضيات تُقرأ كلاماً: «س² + ٣ = ٧» ← «س تربيع زائد ٣ يساوي ٧».
 * - الجداول تُقرأ صفاً صفاً: «العمود: القيمة».
 * - النص يُقسم إلى جمل قصيرة تُقرأ بالتتابع: وقفة طبيعية بينها، ولا ينقطع الكلام الطويل في Chrome.
 * - المقاطع الإنجليزية تُقرأ بصوت إنجليزي.
 * - يُفضَّل الصوت الطبيعي (Natural/Online/Google) إن وُجد في الجهاز، ويختار الطالب غيره من الإعدادات.
 */

const SUP: Record<string, string> = { '²': ' تربيع', '³': ' تكعيب', '¹': ' أس ١', '⁴': ' أس ٤', '⁵': ' أس ٥', '⁻¹': ' أس سالب واحد', 'ⁿ': ' أس ن' }
const SYM: [RegExp, string][] = [
  [/√\s*\(([^)]*)\)/g, ' الجذر التربيعي لـ $1 '],
  [/√\s*/g, ' الجذر التربيعي لـ '],
  [/∛/g, ' الجذر التكعيبي لـ '],
  [/≤|<=/g, ' أصغر من أو يساوي '],
  [/≥|>=/g, ' أكبر من أو يساوي '],
  [/≠|!=/g, ' لا يساوي '],
  [/≈/g, ' يساوي تقريباً '],
  [/→|⟶|->/g, ' تؤول إلى '],
  [/⇐|⟸/g, ' إذن '],
  [/∞/g, ' ما لا نهاية '],
  [/π/g, ' باي '],
  [/∫/g, ' تكامل '],
  [/Σ|∑/g, ' مجموع '],
  [/Δ|∆/g, ' دلتا '],
  [/θ/g, ' ثيتا '],
  [/α/g, ' ألفا '],
  [/β/g, ' بيتا '],
  [/λ/g, ' لامدا '],
  [/μ/g, ' ميو '],
  [/ω/g, ' أوميغا '],
  [/±/g, ' زائد أو ناقص '],
  [/×|\*/g, ' ضرب '],
  [/÷/g, ' على '],
  [/°\s*[سC]/g, ' درجة سيليزية '],
  [/°/g, ' درجة '],
  [/[%٪]/g, ' بالمئة '],
  [/∴/g, ' إذن '],
  [/∈/g, ' ينتمي إلى '],
  [/∪/g, ' اتحاد '],
  [/∩/g, ' تقاطع '],
]

/** وحدات القياس الشائعة في الكتب: تُقرأ كاملة */
const UNITS: [RegExp, string][] = [
  [/م\s*\/\s*ث[²2٢]/g, 'متر لكل ثانية تربيع'],
  [/م\s*\/\s*ث(?!\p{L})/gu, 'متر لكل ثانية'],
  [/كم\s*\/\s*(ساعة|س(?!\p{L}))/gu, 'كيلومتر لكل ساعة'],
  [/(?<!\p{L})(كجم|كغ)(?!\p{L})/gu, 'كيلوجرام'],
  [/(?<!\p{L})سم[²2٢](?!\p{L})/gu, 'سنتيمتر مربع'],
  [/(?<!\p{L})م[²2٢](?!\p{L})/gu, 'متر مربع'],
  [/(?<!\p{L})م[³3٣](?!\p{L})/gu, 'متر مكعب'],
]

/** معادلة أو تعبير: الرموز إلى كلمات (لا يُمس نص عادي بلا رموز) */
function mathToWords(s: string) {
  let t = s
  for (const [re, v] of UNITS) t = t.replace(re, v)
  // اختصار النهاية في كتب الرياضيات: «نهـا»
  t = t.replace(/نهـ\s*ا/g, 'نهاية').replace(/(?<!\p{L})نها(?=\s*\()/gu, 'نهاية')
  // حاصل ضرب قوسين متجاورين
  t = t.replace(/\)\s*\(/g, ') ضرب (')
  for (const [k, v] of Object.entries(SUP)) t = t.split(k).join(v)
  // الأس: س^٢ أو x^2 أو ^(n+1)
  t = t.replace(/\^\s*\(([^)]*)\)/g, ' أس $1 ').replace(/\^\s*([2٢])(?![0-9٠-٩])/g, ' تربيع ').replace(/\^\s*([3٣])(?![0-9٠-٩])/g, ' تكعيب ').replace(/\^\s*(-?[\p{L}\p{N}]+)/gu, ' أس $1 ')
  for (const [re, v] of SYM) t = t.replace(re, v)
  // «دورة/ثانية»: وحدة (كلمتان) ← لكل؛ «٣/٤» أو «س/ص»: كسر ← على
  t = t.replace(/(\p{L}{2,})\s*\/\s*(\p{L}{2,})/gu, '$1 لكل $2')
  t = t.replace(/([\p{N}\p{L})])\s*\/\s*([\p{N}\p{L}(])/gu, '$1 على $2')
  t = t.replace(/\s*=\s*/g, ' يساوي ')
  // الطرح بين حدين أولاً، ثم الإشارة السالبة في أول التعبير أو بعد علامة
  t = t.replace(/([\p{N}\p{L})])\s*[-−]\s*(?=[\p{N}\p{L}(])/gu, '$1 ناقص ')
  t = t.replace(/(^|[\s(]|يساوي )[-−–](?=\s*[\p{N}\p{L}(])/gu, '$1سالب ')
  t = t.replace(/\s*\+\s*/g, ' زائد ')
  t = t.replace(/[()[\]{}]/g, ' ')
  return t
}

/** سطر أو خلية: دون تنسيق ولا أرقام استشهاد، والرياضيات كلاماً */
function clean(raw: string) {
  let l = raw
    .replace(/^#{1,6}\s*/, '')
    .replace(/(^|[.!؟?:؛]\s*)>\s?/g, '$1')
    .replace(/^[-*•]\s+/, '')
    .replace(/^(\d+|[٠-٩]+)[.)]\s+/, '')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\s?\[\d+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[_*]/g, ' ')
  // رموز تعبيرية وزخارف لا تُقرأ
  l = l.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  l = mathToWords(l)
  return l.replace(/\s+([،,.؛:])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

/** نص الرسالة (Markdown) إلى كلام مفهوم */
export function speechText(md: string) {
  const out: string[] = []
  let head: string[] | null = null
  for (let raw of md.replace(/\r/g, '').split('\n')) {
    raw = raw.trim()
    if (!raw) continue
    // جدول: الصف الأول عناوين، وفاصل الجدول لا يُقرأ؛ كل صف: «العنوان: القيمة»
    if (/^\|.*\|$/.test(raw)) {
      const cells = raw.slice(1, -1).split('|').map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
      if (!head) {
        head = cells.map(clean)
        continue
      }
      out.push(cells.map((c, i) => (head![i] && c ? `${head![i]}: ${clean(c)}` : clean(c))).filter(Boolean).join('، ') + '.')
      continue
    }
    head = null
    const l = clean(raw)
    if (!l) continue
    // نهاية كل سطر وقفة: العنوان والبند يُختمان بنقطة إن لم يُختما
    out.push(/[.!؟?:،;؛]$/.test(l) ? l : `${l}.`)
  }
  return out.join('\n')
}

/** جمل قصيرة (حتى نحو ٢٢٠ حرفاً) تُقرأ بالتتابع، مع فصل المقاطع الإنجليزية */
export function speechChunks(text: string): { text: string; lang: 'ar' | 'en' }[] {
  const sentences = text.split(/(?<=[.!؟?؛])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  const parts: { text: string; lang: 'ar' | 'en' }[] = []
  for (const s of sentences) {
    // مقطع لاتيني طويل (٣ كلمات فأكثر) يُقرأ بصوت إنجليزي
    const segs = s.split(/((?:[A-Za-z][A-Za-z'’-]*[\s,.;:!?]*){3,})/)
    for (const seg of segs) {
      const t = seg.trim()
      if (!t || /^[\s\p{P}]*$/u.test(t)) continue
      const lang = /^[A-Za-z]/.test(t) && !/[؀-ۿ]/.test(t) ? 'en' : 'ar'
      // جملة طويلة: تقسم عند الفواصل
      if (t.length <= 220) parts.push({ text: t, lang })
      else {
        let buf = ''
        for (const piece of t.split(/(?<=[،,])\s+/)) {
          if ((buf + ' ' + piece).length > 220 && buf) {
            parts.push({ text: buf, lang })
            buf = piece
          } else buf = buf ? `${buf} ${piece}` : piece
        }
        if (buf) parts.push({ text: buf, lang })
      }
    }
  }
  return parts
}

// ===== الأصوات =====
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
export const canSpeak = !!synth
let voicesCache: SpeechSynthesisVoice[] = []
export function voices(): SpeechSynthesisVoice[] {
  if (!synth) return []
  const v = synth.getVoices()
  if (v.length) voicesCache = v
  return voicesCache
}
if (synth) synth.addEventListener?.('voiceschanged', () => voices())

/** ترتيب الجودة: الأصوات الطبيعية أولاً (Edge: Online Natural، وأندرويد: Google)، ثم المحلية */
const quality = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 0 : /online|neural|wavenet/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : v.localService ? 4 : 3)
export function bestVoice(lang: 'ar' | 'en', preferred?: string, region = /SA|EG|SD/i) {
  const list = voices().filter((v) => v.lang.toLowerCase().startsWith(lang))
  if (preferred) {
    const p = list.find((v) => v.voiceURI === preferred || v.name === preferred)
    if (p) return p
  }
  return [...list].sort((a, b) => quality(a) - quality(b) || (lang === 'ar' ? Number(!region.test(a.lang)) - Number(!region.test(b.lang)) : 0))[0] ?? null
}
export const arabicVoices = () => voices().filter((v) => v.lang.toLowerCase().startsWith('ar')).sort((a, b) => quality(a) - quality(b))

export interface SpeakOptions {
  rate?: number
  voice?: string
  /** المنطوق بلمسة مصرية: يُفضَّل صوت ar-EG */
  egyptian?: boolean
  onEnd?: () => void
}
let token = 0
/** يقرأ النص جملةً جملة؛ استدعاء جديد أو stopSpeaking يوقف القراءة الجارية */
export function speak(md: string, o: SpeakOptions = {}) {
  if (!synth) return
  synth.cancel()
  const my = ++token
  const chunks = speechChunks(speechText(md))
  const ar = bestVoice('ar', o.voice, o.egyptian ? /EG/i : undefined)
  const en = bestVoice('en')
  const rate = o.rate ?? 0.92
  let i = 0
  const nextChunk = () => {
    if (my !== token) return
    if (i >= chunks.length) return o.onEnd?.()
    const c = chunks[i++]
    const u = new SpeechSynthesisUtterance(c.text)
    u.lang = c.lang === 'en' ? 'en-US' : (ar?.lang ?? 'ar-SA')
    u.voice = (c.lang === 'en' ? en : ar) ?? null
    // الصوت المحلي أسرع من الطبيعي عادة: يُبطأ قليلاً ليناسب التعلم
    u.rate = c.lang === 'en' ? Math.min(rate, 0.95) : rate
    u.pitch = 1
    u.onend = () => setTimeout(nextChunk, /[.؟?!]$/.test(c.text) ? 260 : 120)
    u.onerror = () => (my === token ? o.onEnd?.() : undefined)
    synth.speak(u)
  }
  nextChunk()
}
export function stopSpeaking() {
  token++
  synth?.cancel()
}
