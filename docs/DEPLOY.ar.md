# دليل النشر خطوة بخطوة (من الهاتف)

هذا الدليل يشرح كيف تنشر الموقع على Cloudflare Pages مجاناً، وتربط قاعدة البيانات
والتخزين، وتضبط الأسرار، وتنشئ حساب المدير وتفعّل التحقق بخطوتين.

> **ملاحظة مهمة:** لا تحتاج إلى بطاقة ائتمان في أي خطوة. الخدمات المستخدمة كلها ضمن
> الخطط المجانية: Cloudflare Pages و Pages Functions و D1 و KV، وGitHub Actions.

---

## 0. ما ستحتاجه

- حساب **GitHub** فيه المستودع `portfolio`.
- حساب **Cloudflare** مجاني.
- تطبيق **المصادقة** على هاتفك: Google Authenticator أو Microsoft Authenticator.
- مرة واحدة فقط ستحتاج إلى تشغيل أوامر. على الهاتف افتح **GitHub Codespaces** من
  المتصفح: من صفحة المستودع اضغط **Code** ثم **Codespaces** ثم **Create codespace**.
  تعمل كل الأوامر في الطرفية في الأسفل.

احفظ القيم التي تُنشئها في مدير كلمات مرور (مثل Bitwarden أو مدير Google).

---

## 1. إنشاء قاعدة البيانات D1

1. ادخل إلى لوحة Cloudflare من المتصفح.
2. من القائمة اختر **Storage & Databases** ثم **D1 SQL Database**.
3. اضغط **Create** واكتب الاسم بالضبط: `portfolio-db`.
4. انسخ **Database ID** الذي يظهر بعد الإنشاء واحتفظ به.

## 2. إنشاء مخزن KV للوثائق

1. من القائمة اختر **Storage & Databases** ثم **Workers KV**.
2. اضغط **Create instance** واكتب الاسم: `portfolio-docs`.
3. انسخ **Namespace ID** واحتفظ به.

## 3. ربط المستودع بـ Cloudflare Pages

1. من القائمة اختر **Workers & Pages** ثم **Create** ثم **Pages** ثم **Connect to Git**.
2. اختر المستودع `portfolio` ثم **Begin setup**.
3. الإعدادات:
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. من **Environment variables** أضف `NODE_VERSION` بقيمة `22`.
5. اضغط **Save and Deploy**.

من الآن يُعاد النشر تلقائياً عند كل تحديث على الفرع الرئيسي.

## 4. ربط D1 و KV بالمشروع

من مشروع Pages: **Settings** ثم **Bindings** ثم **Add**:

| النوع | الاسم (Variable name) | الهدف |
|---|---|---|
| D1 database | `DB` | `portfolio-db` |
| KV namespace | `DOCS` | `portfolio-docs` |

ثم أعد النشر من **Deployments** ثم **Retry deployment**.

## 5. تحديث معرّفات الملف `wrangler.jsonc`

في المستودع عدّل الملف `wrangler.jsonc` وضع المعرّفين اللذين نسختهما في الخطوتين 1 و 2
مكان الأصفار (`database_id` و `id` لـ KV). هذا يسمح بتشغيل الهجرات من Codespaces.

## 6. إنشاء الجداول

في طرفية Codespaces نفّذ:

```bash
npm ci
npx wrangler login
npm run db:apply:remote
```

إذا ظهر سؤال عن الموافقة اكتب `y` ثم Enter.

## 7. الأسرار والمتغيرات

من مشروع Pages: **Settings** ثم **Environment variables** ثم **Add variable**.

**متغيرات عادية (Variables):**

| الاسم | القيمة |
|---|---|
| `SITE_URL` | عنوان موقعك مثل `https://your-project.pages.dev` (بدون / في النهاية) |
| `GITHUB_USERNAME` | `yswef` |
| `SYNC_INTERVAL_MINUTES` | `15` |

**أسرار (Secret، اختر نوع Encrypted):**

| الاسم | ما هي | كيف تحصل عليها |
|---|---|---|
| `GITHUB_TOKEN` | رمز GitHub للمزامنة والـ Webhook | انظر الخطوة 8 |
| `SYNC_SECRET` | كلمة سر لتشغيل المزامنة | رمز عشوائي طويل (انظر أدناه) |
| `SESSION_SECRET` | تشفير الجلسات | رمز عشوائي طويل |
| `BOOTSTRAP_TOKEN` | يُستخدم مرة واحدة لإنشاء حساب المدير | رمز عشوائي، تحذفه بعد الخطوة 9 |
| `ADMIN_PATH` | مسار لوحة التحكم السري | كلمة عشوائية مثل `lw7-qk2-mR9x4` |
| `GITHUB_WEBHOOK_SECRET` | التحقق من إشعارات GitHub | رمز عشوائي طويل |

**لإنشاء رمز عشوائي:** في Codespaces نفّذ `openssl rand -hex 32` وانسخ الناتج.
كرر الأمر لكل سر، ولا تستخدم الرمز نفسه لأكثر من سر.

> `ADMIN_PATH` يجب أن يكون **عشوائياً وطويلاً**. لا تستخدم كلمات مثل `admin` أو
> `control-panel`. هذا المسار هو باب اللوحة.

**اختياري: التحقق من الرسائل (Turnstile)**

- متغير عادي `PUBLIC_TURNSTILE_SITE_KEY` (مفتاح الموقع من لوحة Turnstile).
- سر `TURNSTILE_SECRET` (المفتاح السري).

بعد إضافة المتغيرات اضغط **Save** ثم أعد النشر.

## 8. إنشاء رمز GitHub

1. من GitHub اختر صورتك ثم **Settings** ثم **Developer settings** ثم
   **Personal access tokens** ثم **Fine-grained tokens** ثم **Generate new token**.
2. الاسم: `portfolio-sync`، وانتهاء الصلاحية حسب رغبتك.
3. **Repository access:** اختر **All repositories** (ليقرأ كل مستودعاتك العامة).
4. الصلاحيات:
   - **Metadata:** Read-only (إلزامي)
   - **Contents:** Read and write (لكتابة ملف المحتوى وقراءة الوثائق)
   - **Webhooks:** Read and write (لتسجيل إشعارات كل مستودع جديد)
   - **Releases:** Read-only
5. انسخ الرمز (يبدأ بـ `github_pat_`) وضعه في السر `GITHUB_TOKEN`.

> الرمز يُحفظ فقط في Cloudflare Secrets. لا تضعه في أي ملف أو محادثة.

## 9. إنشاء حساب المدير وتفعيل التحقق بخطوتين

> **الطريقة السريعة (بدون سكربت):** طبّق المهاجرات (`npm run db:apply:remote`) ثم افتح لوحة
> التحكم وسجّل الدخول بالحساب الافتراضي: المستخدم `admin` وكلمة المرور `Change@Me#2026`
> (أو القيم التي تضعها في `DEFAULT_ADMIN_USERNAME` و`DEFAULT_ADMIN_PASSWORD` في Cloudflare).
> ستُجبَر فوراً على اختيار اسم مستخدم وكلمة مرور جديدين، ثم فعّل التحقق بخطوتين من «الأمان».
> **غيّر البيانات فور النشر**؛ ولمنع إنشاء الحساب الافتراضي ضع `DISABLE_DEFAULT_ADMIN=1`.
> الطريقة المفصّلة أدناه (السكربت) ما زالت تعمل.

1. في Cloudflare أضف السر `BOOTSTRAP_TOKEN` (إن لم تفعل في الخطوة 7) وأعد النشر.
2. في طرفية Codespaces نفّذ (غيّر الرابط والقيمة):

```bash
SITE_URL=https://your-project.pages.dev BOOTSTRAP_TOKEN=القيمة_نفسها npm run admin:create
```

3. سيسألك عن اسم المستخدم وكلمة المرور (12 حرفاً على الأقل، فيها حروف كبيرة وصغيرة
   وأرقام ورموز). لا تستخدم اسم "yswef" ولا كلمات مثل password.
4. سيعرض لك **المفتاح السري (TOTP secret)** و **رموز الاسترداد**:
   - افتح تطبيق المصادقة على هاتفك واختر **إضافة حساب** ثم **إدخال مفتاح**،
     والصق المفتاح. ستظهر لك رموز من ستة أرقام تتغير كل 30 ثانية.
   - انسخ **رموز الاسترداد الثمانية** واحفظها خارج الهاتف (مثلاً في مدير كلمات المرور).
     كل رمز يعمل مرة واحدة فقط.
5. **فوراً** احذف `BOOTSTRAP_TOKEN` من Cloudflare ثم أعد النشر. بعدها لا يمكن إنشاء
   حساب آخر عبر هذا المسار.

## 10. فتح لوحة التحكم

افتح في المتصفح:

```
https://your-project.pages.dev/ADMIN_PATH_الذي_اخترته/
```

1. أدخل اسم المستخدم وكلمة المرور.
2. أدخل الرمز الحالي من تطبيق المصادقة.
3. من قسم **الأمان** يمكنك تغيير كلمة المرور وإدارة التحقق بخطوتين.

أضف الرابط إلى شاشة الهاتف الرئيسية من متصفح Chrome أو Safari إن أردت الوصول السريع.

## 11. تفعيل المزامنة التلقائية

المزامنة تعمل كل 15 دقيقة عبر GitHub Actions (الملف `.github/workflows/sync.yml`).
تحتاج إلى إعداد في GitHub:

1. من المستودع: **Settings** ثم **Secrets and variables** ثم **Actions**.
2. تبويب **Variables** ثم **New repository variable**:
   - الاسم `SITE_URL` والقيمة عنوان موقعك.
3. تبويب **Secrets** ثم **New repository secret**:
   - الاسم `SYNC_SECRET` والقيمة **نفس** القيمة المحفوظة في Cloudflare.
4. من تبويب **Actions** شغّل **sync-portfolio** يدوياً (**Run workflow**) للتجربة.

من اللوحة يمكنك أيضاً الضغط على **مزامنة الآن** في الصفحة الرئيسية.

## 12. إضافة مشروع جديد

أنشئ مستودعاً جديداً على GitHub وارفع الكود. خلال دقائق يظهر تلقائياً في موقعك.
عند إصدار (Release) جديد يتحدث التطبيق تلقائياً.

لتجهيز مشروع PyInstaller للبناء على Windows انسخ الملف `templates/build-windows.yml`
إلى `.github/workflows/build-windows.yml` داخل مستودع المشروع، ثم أنشئ وسماً مثل `v1.0.0`.

## 13. تغيير الدومين لاحقاً

عند ربط نطاق خاص بك (مثل `yousif.example`) غيّر فقط المتغير `SITE_URL` في Cloudflare
ثم في GitHub Variables، وأعد النشر. لا حاجة لتعديل الكود.

## 14. التشغيل المحلي والاختبار (اختياري، من الحاسوب)

```bash
npm ci
npm run build
npm test
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| الصفحة الرئيسية تظهر بيانات فارغة | تأكد أن ملف `content/snapshot.json` موجود، ثم اضغط **نشر المحتوى** من اللوحة |
| "تعذّر الاتصال" في اللوحة | تأكد أن `SITE_URL` بنفس عنوان الموقع بالضبط |
| "انتهت الجلسة" بعد الدخول مباشرة | امسح ملفات تعريف الارتباط للموقع وأعد الدخول |
| "محاولات كثيرة" | انتظر 15 دقيقة. الحماية تمنع تخمين كلمة المرور |
| المزامنة تفشل | افتح **المزامنة** في اللوحة واقرأ سبب الفشل. غالباً صلاحية `GITHUB_TOKEN` |
| لا تظهر المشاريع | تأكد أن المستودعات **عامة** وأن الرمز يملك صلاحية Metadata |
| فقدت تطبيق المصادقة | استخدم رمز استرداد، ثم أعد تفعيل التحقق من قسم **الأمان** |
