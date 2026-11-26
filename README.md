# رفيق | مساعدك الدراسي

مساعد دراسي عربي يجيب من كتب الطالب مع استشهادات بصفحاتها. React + TypeScript + Vite، ووسيط Cloudflare Worker اختياري.

## التشغيل محلياً

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # فحص الأنواع والبناء إلى dist
```

المكتبة والقارئ والبحث النصي والمراجعة تعمل دون أي مفتاح.

## تفعيل الذكاء الاصطناعي محلياً

1. انسخ `worker/.dev.vars.example` إلى `worker/.dev.vars`.
2. ضع `ACCESS_CODE` (رمز طويل من اختيارك) ومفتاح مزود واحد على الأقل.
3. شغّل `npm run worker` في نافذة أخرى.
4. في الإعدادات اكتب رمز الوصول ثم «حفظ وفحص».

`worker/.dev.vars` مستثنى من Git. لا توضع المفاتيح في الواجهة.

## النشر لاحقاً (بموافقة صاحب المشروع)

- الوسيط: من مجلد `worker` اضبط `ALLOWED_ORIGINS` في `wrangler.toml`، وأضف كل سر بـ `wrangler secret put`.
- الواجهة: ابنِ مع `VITE_WORKER_URL` وارفع `dist`. لا ترفع الكتب إلى مستودع عام.

## البنية

- `src/services/books`: استخراج PDF والتعرف الضوئي والمقاطع والحالة.
- `src/services/rag`: البحث النصي والدلالي والهجين.
- `src/services/ai`: مدير المزودين والتناوب. المزودون في `worker/providers.mjs`.
- `src/services/study`: الإجابة والملخصات والاختبارات والبطاقات والخرائط والمقارنة.
