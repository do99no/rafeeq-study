/**
 * كتالوج المزودين. لا مفاتيح هنا: المفاتيح في أسرار الخادم (<المزود>_API_KEY و <المزود>_API_KEY_2 …)
 * أو مشفرة في D1 من لوحة المسؤول.
 *
 * free: نتيجة التحقق من الوثائق الرسمية (2026-11-27). لا يُفعَّل مزود في المجموعة المشتركة إلا إذا
 * كان verified، ووافق المسؤول على شروطه (confirm). models: النماذج المجانية المسموح بها فقط؛
 * أي نموذج خارجها مرفوض حتى لو طُلب.
 */
export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini', key: 'GEMINI_API_KEY',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chat: 'gemini-3.8-flash', embed: 'gemini-embedding-001', dims: 768, embedBatch: 50,
    // يقرأ صور صفحات الكتاب (المعادلات والرسوم التي يسقطها التعرف الضوئي)
    vision: true,
    models: [
      { id: 'gemini-3.8-flash', vision: true, ctx: 1_000_000, arabic: 'good', tier: 'main' },
      { id: 'gemini-3.6-flash', vision: true, ctx: 1_000_000, arabic: 'good', tier: 'main' },
      { id: 'gemini-3.5-flash-lite', vision: true, ctx: 1_000_000, arabic: 'good', tier: 'light' },
    ],
    embedModels: ['gemini-embedding-001'],
    free: {
      status: 'verified', checked: '2026-11-27', source: 'https://ai.google.dev/gemini-api/docs/pricing',
      card: 'لا تُطلب', billing: 'تفعيل الفوترة في المشروع ينقله إلى الطبقة المدفوعة: يجب ألا تُفعَّل',
      limits: 'غير منشورة رقمياً في الوثائق؛ تظهر في AI Studio لكل مشروع. RPD يُصفَّر منتصف الليل بتوقيت المحيط الهادئ',
      quota: 'project', reset: 'pacific-midnight',
      data: 'الطبقة المجانية: يُستخدم المحتوى لتحسين منتجات Google وقد يراجعه بشر؛ لا تُرسل بيانات شخصية',
      age: 'يجب أن يكون المستخدم 18 عاماً فأكثر، ولا يجوز في تطبيق يُرجَّح أن يصل إليه من هم دون 18',
      use: 'للمطورين لأغراض مهنية أو تجارية، لا للاستخدام الاستهلاكي (منطقة رمادية لتطبيق عائلي)',
    },
    confirm: { noBilling: 'لا فوترة مفعّلة في أي مشروع لهذه المفاتيح', age18: 'كل من يستخدم رفيق 18 عاماً فأكثر', terms: 'قرأت شروط Gemini API وأقبل استخدام الطبقة المجانية' },
  },
  groq: {
    name: 'Groq', key: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1', chat: 'openai/gpt-oss-120b',
    models: [{ id: 'openai/gpt-oss-120b', vision: false, ctx: 131_000, arabic: 'ok', tier: 'main' }, { id: 'openai/gpt-oss-20b', vision: false, ctx: 131_000, arabic: 'ok', tier: 'light' }],
    free: {
      status: 'verified', checked: '2026-11-27', source: 'https://console.groq.com/docs/rate-limits',
      card: 'لم تُذكر في الوثائق', billing: 'لا فوترة تلقائية مذكورة؛ تجاوز الحد يعيد 429',
      limits: 'gpt-oss-120b: 30 طلباً/دقيقة، 1000/يوم، 8K رمز/دقيقة، 200K رمز/يوم', quota: 'account', reset: 'rolling',
      data: 'لا تدريب على المدخلات، ولا احتفاظ افتراضي (سجلات إساءة حتى 30 يوماً)',
      age: 'صاحب الحساب 18 عاماً فأكثر؛ وهو مسؤول عن تطبيق قد يصل إليه قاصرون', use: 'الخدمة «ليست للاستخدام الاستهلاكي»',
    },
    confirm: { age18: 'صاحب حساب Groq 18 عاماً فأكثر', terms: 'قرأت شروط Groq وأقبلها لهذا الاستخدام' },
  },
  openrouter: {
    name: 'OpenRouter', key: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1', chat: 'google/gemma-4-26b-a4b-it:free',
    // حاجز ضد التكلفة: لا يقبل إلا النماذج المجانية
    freeOnly: /(:free$|^openrouter\/free$)/,
    // لا يُوجَّه الطلب إلى مشغّل يحتفظ بالمدخلات أو يدرّب عليها
    extra: { provider: { data_collection: 'deny' } },
    models: [{ id: 'google/gemma-4-26b-a4b-it:free', vision: false, ctx: 128_000, arabic: 'ok', tier: 'main' }],
    free: {
      status: 'verified', checked: '2026-11-27', source: 'https://openrouter.ai/docs/api-reference/limits',
      card: 'شروط الخدمة تقول إن الاستدعاء يتطلب شراء رصيد، وصفحة الحدود تسمح بالنماذج المجانية دون شراء: تعارض', billing: 'لا شحن تلقائي إلا باختيارك',
      limits: '20 طلباً/دقيقة، و50 طلباً/يوماً لكل الحساب (1000 بعد شراء 10 أرصدة، وهذا ممنوع هنا)', quota: 'account', reset: 'utc-midnight',
      data: 'بعض المشغّلين قد يدرّبون على المدخلات؛ يرسل رفيق data_collection=deny', age: 'المستخدم 18 عاماً فأكثر', use: '—',
    },
    confirm: { age18: 'كل من يستخدم رفيق 18 عاماً فأكثر', noCredits: 'لن يُشحن رصيد في حساب OpenRouter', terms: 'اطلعت على تعارض شرط الرصيد وأقبل الاستخدام المجاني' },
  },
  cloudflare: {
    name: 'Cloudflare Workers AI', key: 'CLOUDFLARE_AI_TOKEN', account: 'CLOUDFLARE_ACCOUNT_ID',
    base: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1',
    chat: '@cf/openai/gpt-oss-120b', embed: '@cf/baai/bge-m3', embedBatch: 32,
    models: [{ id: '@cf/openai/gpt-oss-120b', vision: false, ctx: 128_000, arabic: 'ok', tier: 'main' }, { id: '@cf/openai/gpt-oss-20b', vision: false, ctx: 128_000, arabic: 'ok', tier: 'light' }],
    embedModels: ['@cf/baai/bge-m3'],
    free: {
      status: 'verified', checked: '2026-11-27', source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      card: 'لا تُطلب للخطة المجانية', billing: 'على Workers Free تفشل الطلبات بعد الحد؛ على Workers Paid تُحسب تلقائياً بسعر 0.011$ لكل 1000 Neuron',
      limits: '10,000 Neuron يومياً لكل الحساب، تُصفَّر 00:00 UTC', quota: 'account', reset: 'utc-midnight',
      data: 'لا يُستخدم المحتوى لتدريب النماذج', age: 'لم يُذكر', use: 'لا قيود منشورة على الاستخدام المجاني',
    },
    confirm: { freePlan: 'حساب Cloudflare على خطة Workers Free (لا Workers Paid)', terms: 'قرأت شروط Cloudflare وأقبلها' },
  },
  cohere: {
    name: 'Cohere', key: 'COHERE_API_KEY',
    base: 'https://api.cohere.ai/compatibility/v1', chat: 'command-a-03-2025',
    rerank: 'rerank-v5.0-pro', rerankUrl: 'https://api.cohere.com/v2/rerank',
    models: [],
    free: {
      status: 'blocked', checked: '2026-11-27', source: 'https://cohere.com/pricing',
      reason: 'المفتاح التجريبي «غير مسموح للإنتاج أو الاستخدام التجاري»، واتفاقية SaaS تمنع الاستخدام «لأغراض شخصية أو عائلية أو منزلية»',
      quota: 'key', limits: '1000 طلب شهرياً', card: '—', billing: '—', data: 'قد يُشارك للتحسين', age: 'سن الرشد', use: 'غير مناسب لتطبيق عائلي',
    },
  },
  mistral: {
    name: 'Mistral AI', key: 'MISTRAL_API_KEY',
    base: 'https://api.mistral.ai/v1', chat: 'mistral-small-latest', embed: 'mistral-embed', embedBatch: 32,
    // وثائقه متعارضة بشأن المجانية، فلا يعمل إلا بموافقة صريحة
    flag: 'MISTRAL_CONFIRMED_FREE',
    models: [],
    free: { status: 'unverified', checked: '2026-11-27', reason: 'تعذّر قراءة صفحة الطبقات الرسمية؛ مصادر غير رسمية متعارضة' },
  },
  sambanova: {
    name: 'SambaNova', key: 'SAMBANOVA_API_KEY',
    base: 'https://api.sambanova.ai/v1', chat: 'gemma-4-31B-it', models: [],
    free: { status: 'unverified', checked: '2026-11-27', reason: 'صفحة الحدود الرسمية غير موجودة (404)، وصفحة الخطط تذكر وسيلة دفع' },
  },
  nvidia: {
    name: 'NVIDIA NIM', key: 'NVIDIA_API_KEY',
    base: 'https://integrate.api.nvidia.com/v1', chat: 'nvidia/nemotron-3-ultra-550b-a55b', models: [],
    free: { status: 'unverified', checked: '2026-11-27', reason: 'الوصول المجاني تجريبي «لا للإنتاج»؛ لم تُقرأ الشروط الرسمية' },
  },
}

export const modelOf = (id, task, env) => env[`${id.toUpperCase()}_${task === 'chat' ? '' : `${task.toUpperCase()}_`}MODEL`] || PROVIDERS[id][task]

export function isConfigured(id, env) {
  const p = PROVIDERS[id]
  return Boolean(env[p.key] && (!p.account || env[p.account]) && (!p.flag || env[p.flag] === 'true'))
}

/** مفاتيح مزود من أسرار الخادم: GEMINI_API_KEY ثم GEMINI_API_KEY_2 … (كل مفتاح في متغير) */
export function envKeys(id, env) {
  const p = PROVIDERS[id]
  const out = []
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? p.key : `${p.key}_${i}`
    if (env[name]) out.push({ name, value: env[name] })
  }
  return out
}
