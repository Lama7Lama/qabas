# إعداد Groq

يستخدم قبس نموذج GPT‑OSS 120B عبر Groq لتحليل سبب الاختيار وإجابة موقف التطبيق.

انسخ `.env.groq.example` إلى `.env.local`، وضع مفتاحك في `GROQ_API_KEY` واترك `QABAS_AI_PROVIDER=groq`. الملف مستثنى من Git، والمفتاح لا يدخل ملفات المتصفح.

```sh
npm run build
npm run serve:groq
```

افتح `http://127.0.0.1:4173/`. بعد تعديل المحتوى أعد البناء والتشغيل؛ بعد تعديل الإعدادات أعد التشغيل.

[خطوات التثبيت والتشغيل](CLOUDFLARE.md) · [الأمان والخصوصية](SECURITY.md) · [سياسة بيانات Groq](https://console.groq.com/docs/your-data) · [شروط الخدمة](https://console.groq.com/docs/legal/services-agreement).
