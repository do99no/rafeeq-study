/** توحيد الكتابة العربية للبحث فقط؛ النص المعروض يبقى كما استُخرج. */
export const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))

export const normalize = (s: string) =>
  toLatinDigits(s)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()

export const stem = (w: string) => {
  const s = w.replace(/^(وال|بال|فال|كال|لل|ال)(?=.{2,})/, '')
  return s.length > 4 ? s.replace(/(ات|ون|ين|يه|ه|ي)$/, '') : s
}

const STOP = new Set(
  'ما ماذا هو هي هم في من على عن الى كيف اشرح لي هل او ام ان انه اذا مع بين التي الذي الذين وكيف لماذا اذكر عرف وضح المقصود هذا هذه ذلك تلك كل كان كانت قد لا لم لن ثم اي عند حيث مثل هناك يكون تكون وهو وهي the a an of in on to is are and or what how'
    .split(' ')
    .map((w) => stem(normalize(w))),
)

export const tokens = (s: string) =>
  normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .map(stem)
    .filter((w) => w && (w.length > 1 || /[a-z0-9]/.test(w)) && !STOP.has(w))

/** نسبة كلمات المقتطف الموجودة فعلاً في النص: للتحقق من أن الاقتباس غير مختلق. */
export function overlap(quote: string, text: string) {
  const q = tokens(quote)
  if (!q.length) return 0
  const t = new Set(tokens(text))
  return q.filter((w) => t.has(w)).length / q.length
}
