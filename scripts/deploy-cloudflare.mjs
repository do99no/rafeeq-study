// نشر خادم رفيق على Cloudflare (الخطة المجانية فقط) بعد أن يسجّل صاحب الحساب الدخول: npx wrangler login
// node scripts/deploy-cloudflare.mjs
// لا يطبع أي سر. أسرار الإنتاج جديدة (ليست أسرار التطوير)، ويُحفظ رمز الإعداد وحده في worker/.local/production-setup.txt (مستثنى من Git).
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const W = 'worker'
const wr = (args, opts = {}) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.168.0', ...args], { cwd: W, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts })
const step = (s) => console.log(`\n== ${s}`)

step('الحساب')
const who = wr(['whoami'])
if (/not authenticated/i.test(who)) throw new Error('سجّل الدخول أولاً: npx wrangler login')
console.log(who.match(/associated with the email|Account Name.*|│ .* │ [0-9a-f]{32} │/g)?.length ? 'مسجّل الدخول' : 'مسجّل الدخول (تفاصيل الحساب غير معروضة)')

step('قاعدة D1 المجانية')
const toml = readFileSync(`${W}/wrangler.toml`, 'utf8')
let id = toml.match(/^database_id\s*=\s*"([0-9a-f-]{36})"/m)?.[1]
if (!id) {
  const list = JSON.parse(wr(['d1', 'list', '--json']) || '[]')
  id = list.find((d) => d.name === 'rafeeq')?.uuid
  if (!id) {
    const out = wr(['d1', 'create', 'rafeeq'])
    id = out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/)?.[1] ?? out.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1]
  }
  if (!id) throw new Error('تعذّر معرفة database_id')
  const block = `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "rafeeq"\ndatabase_id = "${id}"`
  writeFileSync(`${W}/wrangler.toml`, toml.replace(/# \[\[d1_databases\]\]\n# binding = "DB"\n# database_name = "rafeeq"\n# database_id = "\.\.\."/, block))
  if (!readFileSync(`${W}/wrangler.toml`, 'utf8').includes(id)) throw new Error('لم يُكتب database_id في wrangler.toml')
}
console.log('D1 جاهزة')

step('أسرار الإنتاج')
const dev = Object.fromEntries(readFileSync(`${W}/.dev.vars`, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
const setupFile = `${W}/.local/production-setup.txt`
const prodFile = `${W}/.local/production-secrets.json`
// تُولَّد مرة واحدة وتُحفظ محلياً، كي لا تتغير بإعادة التشغيل (تغيير الفلفل يبطل كلمات المرور)
const prod = existsSync(prodFile) ? JSON.parse(readFileSync(prodFile, 'utf8')) : { PASSWORD_PEPPER: randomBytes(32).toString('base64url'), SETUP_CODE: randomBytes(12).toString('base64url'), KEYS_SECRET: randomBytes(32).toString('base64url') }
writeFileSync(prodFile, JSON.stringify(prod), { mode: 0o600 })
writeFileSync(setupFile, `رمز الإعداد الأول لرفيق (يُكتب مرة واحدة في صفحة الإعداد):\n${prod.SETUP_CODE}\n`, { mode: 0o600 })
// مفاتيح Gemini التي نجحت في الاختبار الحقيقي فقط (المفتاح الثاني رفضته الطبقة المجانية)
const gemini = ['GEMINI_API_KEY', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6'].filter((k) => dev[k])
const lib = existsSync('books-work/library-code.txt') ? readFileSync('books-work/library-code.txt', 'utf8').trim() : ''
// الأسماء في الإنتاج متتالية كما يقرؤها الخادم: GEMINI_API_KEY ثم _2 …
const secrets = { ...prod, APPROVED_PROVIDERS: 'gemini', ...(lib ? { LIBRARY_CODE: lib } : {}) }
gemini.forEach((k, i) => (secrets[i ? `GEMINI_API_KEY_${i + 1}` : 'GEMINI_API_KEY'] = dev[k]))
// الخادم يجب أن يوجد قبل رفع أسراره دفعة واحدة
step('النشر')
const out = wr(['deploy'])
const url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0]
if (!url) throw new Error('تعذّر معرفة رابط الخادم من مخرجات النشر')
writeFileSync(`${W}/.local/worker-url.txt`, url)
const tmp = `${W}/.local/secrets-bulk.json`
writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 })
try {
  wr(['secret', 'bulk', '.local/secrets-bulk.json'])
} finally {
  rmSync(tmp, { force: true })
}
console.log(`رُفعت ${Object.keys(secrets).length} أسرار (منها ${gemini.length} مفاتيح Gemini). القيم غير معروضة.`)

console.log('الخادم:', url)
console.log('رمز الإعداد محفوظ في:', setupFile)
