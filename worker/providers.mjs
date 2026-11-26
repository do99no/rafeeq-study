/**
 * كتالوج المزودين. لا مفاتيح هنا: كل مفتاح Secret باسمه في بيئة Worker.
 * يمكن تغيير أي نموذج بمتغير مثل GEMINI_MODEL دون تعديل الكود.
 * روجعت المعرّفات من الوثائق الرسمية في 2026-11-25.
 */
export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini', key: 'GEMINI_API_KEY',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chat: 'gemini-3.8-flash', embed: 'gemini-embedding-001', dims: 768, embedBatch: 50,
    // يقرأ صور صفحات الكتاب (المعادلات والرسوم التي يسقطها التعرف الضوئي)
    vision: true,
    note: 'قد تُستخدم بيانات الخطة المجانية لتحسين خدمات Google.',
  },
  groq: {
    name: 'Groq', key: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1', chat: 'openai/gpt-oss-120b',
  },
  openrouter: {
    name: 'OpenRouter', key: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1', chat: 'google/gemma-4-26b-a4b-it:free',
    // حاجز ضد التكلفة: لا يقبل إلا النماذج المجانية
    freeOnly: /(:free$|^openrouter\/free$)/,
    note: 'سياسة البيانات تختلف حسب مشغّل النموذج المجاني.',
  },
  mistral: {
    name: 'Mistral AI', key: 'MISTRAL_API_KEY',
    base: 'https://api.mistral.ai/v1', chat: 'mistral-small-latest', embed: 'mistral-embed', embedBatch: 32,
    // وثائقه متعارضة بشأن المجانية، فلا يعمل إلا بموافقة صريحة
    flag: 'MISTRAL_CONFIRMED_FREE',
    note: 'لم نتأكد من مجانية الاستخدام.',
  },
  cloudflare: {
    name: 'Cloudflare Workers AI', key: 'CLOUDFLARE_AI_TOKEN', account: 'CLOUDFLARE_ACCOUNT_ID',
    base: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1',
    chat: '@cf/google/gemma-4-26b-a4b-it', embed: '@cf/baai/bge-m3', embedBatch: 32,
  },
  cohere: {
    name: 'Cohere', key: 'COHERE_API_KEY',
    base: 'https://api.cohere.ai/compatibility/v1', chat: 'command-a-03-2025',
    rerank: 'rerank-v5.0-pro', rerankUrl: 'https://api.cohere.com/v2/rerank',
    note: 'مفتاح تجريبي لغير الاستخدام التجاري، وقد تُستخدم بياناته للتطوير.',
  },
  sambanova: {
    name: 'SambaNova', key: 'SAMBANOVA_API_KEY',
    base: 'https://api.sambanova.ai/v1', chat: 'gemma-4-31B-it',
  },
  nvidia: {
    name: 'NVIDIA NIM', key: 'NVIDIA_API_KEY',
    base: 'https://integrate.api.nvidia.com/v1', chat: 'nvidia/nemotron-3-ultra-550b-a55b',
    note: 'نسخة تجريبية لغير الإنتاج، وقد يُستخدم المحتوى لتحسين خدماتها.',
  },
}

export const modelOf = (id, task, env) => env[`${id.toUpperCase()}_${task === 'chat' ? '' : `${task.toUpperCase()}_`}MODEL`] || PROVIDERS[id][task]

export function isConfigured(id, env) {
  const p = PROVIDERS[id]
  return Boolean(env[p.key] && (!p.account || env[p.account]) && (!p.flag || env[p.flag] === 'true'))
}
