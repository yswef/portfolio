# سجل التعديلات — الدخول الافتراضي وإصلاحات

## 1) حساب افتراضي للوحة التحكم
- **السبب:** تعذّر إنشاء المدير عبر `admin:create` (يتطلب BOOTSTRAP_TOKEN وطرفية).
- **المنطق الجديد:** عند أول محاولة دخول والجدول `users` فارغ، يُنشأ الحساب
  `admin` / `Change@Me#2026` (قابل للتغيير بالمتغيرين `DEFAULT_ADMIN_USERNAME`
  و`DEFAULT_ADMIN_PASSWORD`، ويُعطَّل بـ `DISABLE_DEFAULT_ADMIN=1`) مع العلم `must_change_password=1`.
- **قيود الحساب الافتراضي:** كل مسارات `/api/admin` ترجع `403 password_change_required`
  عدا `/me` و`/password` و`/logout`. الواجهة تعرض شاشة تغيير الاسم وكلمة المرور فقط.
- **بعد التغيير:** تُلغى كل الجلسات ويُطلب دخول جديد؛ يزول العلم.
- **التحقق بخطوتين:** صار اختيارياً؛ حساب بلا TOTP يدخل بكلمة المرور فقط، ومن فعّله يمر بخطوة الرمز كالسابق.
- **الملفات:** `migrations/0001_default_admin.sql`, `src/db/schema.ts`, `src/server/env.ts`,
  `src/server/auth.ts`, `src/api/admin.ts`, `src/admin/api.ts`, `src/admin/App.svelte`,
  `src/admin/screens/Login.svelte`, `src/admin/screens/Security.svelte`.
- **تنبيه أمني:** قبل تغيير البيانات يستطيع من يعرف الحساب الافتراضي ورابط اللوحة السرّي الدخول.
  غيّرها فور أول نشر، أو ضع `DEFAULT_ADMIN_PASSWORD` سرّاً في Cloudflare.

## 2) إصلاحات
- **التحليلات (مؤكد بالاختبار):** `track()` في `src/server/analytics.ts` كان يمرّر 39 قيمة
  لـ 38 علامة `?` (قيمة `0` زائدة لـ `is_bot`) فيفشل إدخال أي زيارة جديدة
  (`column index out of range`). حُذفت القيمة الزائدة.
- **سر الجلسة:** مسارا `2fa/enable` و`2fa/disable` كانا يستخدمان `SESSION_SECRET ?? ''` بينما
  التشفير يستخدم قيمة احتياطية مختلفة؛ وُحّدت عبر `sessionSecret(env)`.
- **تغيير كلمة المرور:** الواجهة لم تعد للدخول بعد إلغاء الجلسات؛ تعيدك الآن لشاشة الدخول.
- **رسائل الخطأ:** أُضيفت نصوص عربية لـ weak_password وinvalid_password وغيرها (كانت «حدث خطأ (400)»).

## 3) اختبارات
`tests/default-admin.test.ts` (6 اختبارات): إنشاء الحساب، القيود، رفض كلمات ضعيفة،
تغيير الاسم/الكلمة، وإدخال الزيارة الأولى. المجموع 59 ناجحاً، `astro check` و`build` بلا أخطاء.
