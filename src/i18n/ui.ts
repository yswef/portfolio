/**
 * Interface strings for both languages.
 *
 * Everything the owner writes lives in the database and arrives through the
 * content snapshot; this file only holds the frame around it (navigation,
 * labels, states) so that both languages stay in sync. `ar` is the primary
 * language and the fallback for any missing key.
 */
import type { Locale } from '../server/content-types';

export const LOCALES: Locale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'ar';

export const DIRECTION: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr' };
export const HTML_LANG: Record<Locale, string> = { ar: 'ar-SA', en: 'en' };

const strings = {
  'nav.home': { ar: 'الرئيسية', en: 'Home' },
  'nav.projects': { ar: 'المشاريع', en: 'Projects' },
  'nav.apps': { ar: 'التطبيقات', en: 'Apps' },
  'nav.pages': { ar: 'صفحات تعليمية', en: 'Study pages' },
  'nav.services': { ar: 'الخدمات', en: 'Services' },
  'nav.resume': { ar: 'السيرة', en: 'Résumé' },
  'nav.blog': { ar: 'المدونة', en: 'Blog' },
  'nav.learning': { ar: 'أتعلّم الآن', en: 'Learning' },
  'nav.contact': { ar: 'تواصل', en: 'Contact' },
  'nav.social': { ar: 'التواصل الاجتماعي', en: 'Elsewhere' },
  'nav.menu': { ar: 'القائمة', en: 'Menu' },
  'nav.close': { ar: 'إغلاق', en: 'Close' },

  'action.viewProject': { ar: 'عرض المشروع', en: 'View project' },
  'action.repository': { ar: 'المستودع', en: 'Repository' },
  'action.download': { ar: 'تنزيل', en: 'Download' },
  'action.downloads': { ar: 'التنزيلات', en: 'Downloads' },
  'action.allProjects': { ar: 'كل المشاريع', en: 'All projects' },
  'action.allApps': { ar: 'كل التطبيقات', en: 'All apps' },
  'action.allPosts': { ar: 'كل المقالات', en: 'All articles' },
  'action.readMore': { ar: 'اقرأ المزيد', en: 'Read more' },
  'action.backHome': { ar: 'الصفحة الرئيسية', en: 'Back home' },
  'action.copy': { ar: 'نسخ', en: 'Copy' },
  'action.copied': { ar: 'تم النسخ', en: 'Copied' },
  'action.send': { ar: 'إرسال الطلب', en: 'Send request' },
  'action.sending': { ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'action.star': { ar: 'ادعمني بنجمة', en: 'Star the repo' },
  'action.starWithGithub': { ar: 'أضف نجمة بحسابك', en: 'Star with GitHub' },
  'action.openRepo': { ar: 'افتح صفحة المستودع', en: 'Open repository' },
  'action.starConsent': {
    ar: 'بالضغط أوافق على إضافة نجمة واحدة لهذا المستودع من حسابي.',
    en: 'By clicking, I agree to star this repository once with my account.',
  },
  'action.loadMore': { ar: 'المزيد', en: 'Load more' },
  'action.openDocs': { ar: 'افتح التوثيق', en: 'Open documentation' },
  'action.readme': { ar: 'اقرأ التوثيق', en: 'Read the documentation' },

  'label.stars': { ar: 'نجمة', en: 'stars' },
  'label.forks': { ar: 'تفرّع', en: 'forks' },
  'label.updated': { ar: 'آخر تحديث', en: 'Last update' },
  'label.version': { ar: 'الإصدار', en: 'Version' },
  'label.size': { ar: 'الحجم', en: 'Size' },
  'label.platform': { ar: 'النظام', en: 'Platform' },
  'label.license': { ar: 'الترخيص', en: 'Licence' },
  'label.language': { ar: 'اللغة', en: 'Language' },
  'label.languages': { ar: 'اللغات المستخدمة', en: 'Languages' },
  'label.topics': { ar: 'المواضيع', en: 'Topics' },
  'label.requirements': { ar: 'متطلبات التشغيل', en: 'Requirements' },
  'label.releaseNotes': { ar: 'ملاحظات الإصدار', en: 'Release notes' },
  'label.files': { ar: 'الملفات', en: 'Files' },
  'label.checksum': { ar: 'بصمة SHA-256', en: 'SHA-256 checksum' },
  'label.pricing': { ar: 'السعر', en: 'Pricing' },
  'label.payment': { ar: 'طريقة الدفع', en: 'Payment' },
  'label.free': { ar: 'مجاني', en: 'Free' },
  'label.paid': { ar: 'مدفوع', en: 'Paid' },
  'label.donation': { ar: 'تبرّع', en: 'Donation' },
  'label.progress': { ar: 'التقدّم', en: 'Progress' },
  'label.readingTime': { ar: 'دقيقة قراءة', en: 'min read' },
  'label.publishedOn': { ar: 'نُشر في', en: 'Published' },
  'label.tags': { ar: 'الوسوم', en: 'Tags' },
  'label.category': { ar: 'التصنيف', en: 'Category' },
  'label.level': { ar: 'المستوى', en: 'Level' },
  'label.since': { ar: 'منذ', en: 'Since' },
  'label.opensInNewTab': { ar: '(يفتح في تبويب جديد)', en: '(opens in a new tab)' },
  'label.privatePage': { ar: 'صفحة خاصة', en: 'Private page' },
  'label.pageFiles': { ar: 'ملف', en: 'files' },
  'label.status': { ar: 'الحالة', en: 'Status' },
  'label.country': { ar: 'الدولة', en: 'Country' },
  'label.noData': { ar: 'لا توجد بيانات بعد.', en: 'Nothing here yet.' },

  'section.projects': { ar: 'مشاريع مختارة', en: 'Selected projects' },
  'section.projectsNote': {
    ar: 'تُحدَّث هذه القائمة من حساب GitHub تلقائياً.',
    en: 'This list is synchronised from the GitHub account automatically.',
  },
  'section.apps': { ar: 'تطبيقات للتنزيل', en: 'Apps to download' },
  'section.appsNote': {
    ar: 'نسخ جاهزة للتنزيل مباشرة من صفحة الإصدارات.',
    en: 'Ready-to-download builds from the release pages.',
  },
  'section.services': { ar: 'ما أقدّمه', en: 'What I do' },
  'section.skills': { ar: 'المهارات', en: 'Skills' },
  'section.learning': { ar: 'ما أتعلّمه حالياً', en: 'Currently learning' },
  'section.languages': { ar: 'لغات البرمجة في مستودعاتي', en: 'Languages across my repositories' },
  'section.blog': { ar: 'كتابات', en: 'Writing' },
  'section.social': { ar: 'مواقع التواصل', en: 'Find me elsewhere' },
  'section.experience': { ar: 'الخبرة العملية', en: 'Experience' },
  'section.credentials': { ar: 'الشهادات والمؤهلات', en: 'Education and certificates' },
  'section.facts': { ar: 'لمحة سريعة', en: 'At a glance' },
  'section.contactForm': { ar: 'تفاصيل الطلب', en: 'Request details' },

  'form.name': { ar: 'الاسم', en: 'Name' },
  'form.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'form.phone': { ar: 'الجوال (اختياري)', en: 'Phone (optional)' },
  'form.company': { ar: 'الجهة (اختياري)', en: 'Company (optional)' },
  'form.projectType': { ar: 'نوع العمل', en: 'Type of work' },
  'form.budget': { ar: 'الميزانية (اختياري)', en: 'Budget (optional)' },
  'form.subject': { ar: 'الموضوع', en: 'Subject' },
  'form.message': { ar: 'وصف العمل', en: 'Describe the work' },
  'form.messageHint': {
    ar: 'اذكر الهدف، المدة المتوقعة، وأي تفاصيل تقنية تعرفها.',
    en: 'Mention the goal, expected timeline and any technical details you know.',
  },
  'form.honeypot': { ar: 'اترك هذا الحقل فارغاً', en: 'Leave this field empty' },
  'form.success': {
    ar: 'وصل الطلب. سأعود إليك على البريد المذكور.',
    en: 'The request arrived. I will reply to the address you gave.',
  },
  'form.error': { ar: 'تعذّر الإرسال. حاول مرة أخرى بعد قليل.', en: 'Could not send. Please try again shortly.' },
  'form.rateLimited': { ar: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.', en: 'Too many attempts. Wait a moment and try again.' },
  'form.turnstileFailed': { ar: 'فشل التحقق من المتصفح. أعد المحاولة.', en: 'The browser check failed. Please retry.' },
  'form.invalidEmail': { ar: 'البريد الإلكتروني غير صحيح.', en: 'The email address is not valid.' },
  'form.required': { ar: 'هذا الحقل مطلوب.', en: 'This field is required.' },
  'form.turnstileMissing': {
    ar: 'حماية النموذج غير مفعّلة بعد على هذا الموقع.',
    en: 'Form protection is not configured on this site yet.',
  },

  'state.loading': { ar: 'جارٍ التحميل…', en: 'Loading…' },
  'state.empty': { ar: 'لا يوجد محتوى منشور بعد.', en: 'No published content yet.' },
  'state.error': { ar: 'حدث خطأ.', en: 'Something went wrong.' },
  'state.notFoundTitle': { ar: 'الصفحة غير موجودة', en: 'Page not found' },
  'state.notFoundBody': {
    ar: 'الرابط غير صحيح أو أن المحتوى نُقل. جرّب البحث من الصفحة الرئيسية.',
    en: 'The address is wrong or the content moved. Try starting from the home page.',
  },
  'state.privateTitle': { ar: 'صفحة خاصة', en: 'Private page' },
  'state.privateBody': {
    ar: 'هذه الصفحة متاحة لصاحب الموقع فقط. سجّل الدخول من لوحة التحكم لعرضها.',
    en: 'This page is available to the owner only. Sign in to the control panel to view it.',
  },

  'footer.rights': { ar: 'جميع الحقوق محفوظة', en: 'All rights reserved' },
  'footer.builtWith': { ar: 'مبني على', en: 'Built on' },
  'footer.privacy': { ar: 'الخصوصية والتحليلات', en: 'Privacy and analytics' },
  'footer.source': { ar: 'كود الموقع', en: 'Site source' },
  'footer.updated': { ar: 'آخر تحديث للمحتوى', en: 'Content updated' },
  'footer.admin': { ar: 'دخول المالك', en: 'Owner sign-in' },

  'a11y.skipToContent': { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' },
  'a11y.customCursorNote': {
    ar: 'المؤشر المخصّص تعطيل لتفضيلات الحركة أو للشاشات اللمسية.',
    en: 'The custom pointer is disabled for reduced motion or touch screens.',
  },
  'label.worldClock': { ar: 'التوقيت المحلي', en: 'Local time' },
  'label.availability': { ar: 'التوفّر', en: 'Availability' },
  'label.findMe': { ar: 'اوجدني على', en: 'Find me on' },
  'label.contactDirect': { ar: 'تواصل مباشر', en: 'Direct contact' },
  'label.workRequest': { ar: 'طلب عمل', en: 'Work request' },
  'label.docsMode.readme': { ar: 'توثيق README', en: 'README documentation' },
  'label.docsMode.single': { ar: 'صفحة توثيق واحدة', en: 'Single documentation page' },
  'label.docsMode.multi': { ar: 'توثيق متعدد الصفحات', en: 'Multi-page documentation' },
  'label.docsMode.none': { ar: 'بدون توثيق', en: 'No documentation' },
  'label.openStandalone': { ar: 'افتح في صفحة مستقلة', en: 'Open standalone' },
  'label.docsSandboxNote': {
    ar: 'يُعرض التوثيق داخل إطار معزول بسياسة أمان صارمة.',
    en: 'Documentation is shown inside an isolated frame with a strict policy.',
  },
} as const;

export type UiKey = keyof typeof strings;

export function t(key: UiKey, locale: Locale = 'ar'): string {
  const entry = strings[key];
  if (!entry) return key;
  return (entry[locale] ?? entry.ar) as string;
}

/** A locale-aware translator: `const tr = translator('en'); tr('nav.home')`. */
export function translator(locale: Locale) {
  return (key: UiKey) => t(key, locale);
}

export const UI_KEYS = Object.keys(strings) as UiKey[];
