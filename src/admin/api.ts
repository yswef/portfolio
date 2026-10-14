/**
 * Thin client for `/api/admin`. The CSRF token lives only in memory: it is
 * issued after the second factor succeeds and is sent back on every write.
 */
let csrfToken: string | null = null;

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;

  constructor(status: number, code: string, body: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function setCsrf(token: string | null) {
  csrfToken = token;
}

export function hasCsrf() {
  return Boolean(csrfToken);
}

export async function api<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  const response = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || data.ok === false) {
    throw new ApiError(response.status, String(data.error ?? 'request_failed'), data);
  }
  return data as T;
}

/** Human message for an error code, in Arabic. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.';
  const known: Record<string, string> = {
    unauthenticated: 'انتهت الجلسة. سجّل الدخول من جديد.',
    second_factor_required: 'أدخل رمز التحقق من التطبيق.',
    csrf: 'انتهت صلاحية الجلسة. أعد تحميل الصفحة.',
    invalid_credentials: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    account_locked: 'الحساب مقفل مؤقتاً بسبب محاولات متكررة.',
    too_many_attempts: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
    invalid_code: 'رمز التحقق غير صحيح.',
    code_reused: 'هذا الرمز استُخدم من قبل. انتظر الرمز التالي.',
    second_factor_not_configured: 'التحقق بخطوتين غير مفعّل لهذا الحساب.',
    validation_failed: 'بعض الحقول تحتاج إلى مراجعة.',
    missing_github_token: 'رمز GitHub غير مضبوط في إعدادات Cloudflare.',
    publish_failed: 'فشل النشر إلى GitHub. التفاصيل في سجل المزامنة.',
    too_large: 'المحتوى أكبر من الحد المسموح.',
    password_change_required: 'يجب تغيير كلمة المرور الافتراضية أولاً.',
    invalid_password: 'كلمة المرور الحالية غير صحيحة.',
    weak_password: 'كلمة المرور ضعيفة: 12 حرفاً على الأقل مع حروف كبيرة وصغيرة ورقم ورمز، بدون كلمات شائعة (مثل admin أو password).',
    same_password: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
    invalid_username: 'اسم المستخدم: 3 إلى 40 حرفاً (أحرف إنجليزية وأرقام و . _ - فقط).',
    username_taken: 'اسم المستخدم مستخدم من قبل.',
  };
  return known[error.code] ?? `حدث خطأ (${error.status}).`;
}
