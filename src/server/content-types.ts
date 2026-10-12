/**
 * Shape of the content snapshot that the pre-rendered site is built from, plus
 * the defaults used when a field has not been filled in yet.
 *
 * Nothing about the site owner is invented here: the seed values are exactly
 * the facts that were supplied, and everything else is empty until it is typed
 * into the control panel.
 */
export type Locale = 'ar' | 'en';

export interface Bilingual {
  ar: string;
  en: string;
}

export interface WithBilingual<T = string> {
  ar: T;
  en: T;
}

export function bi(ar = '', en = ''): Bilingual {
  return { ar, en };
}

export interface SnapshotProfile {
  name: Bilingual;
  headline: Bilingual;
  summary: Bilingual;
  yearsExperience: number | null;
  selfTaught: boolean | null;
  city: Bilingual;
  country: string;
  countryCode: string;
  regionCode: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  languages: Bilingual;
  availability: Bilingual;
  email: string;
  phone: string;
  whatsapp: string;
  githubUsername: string;
  avatar: string;
  resumeUrl: string;
}

export interface SnapshotSeo {
  defaultTitle: Bilingual;
  defaultDescription: Bilingual;
  keywords: string[];
  ogImage: string;
  twitterHandle: string;
  googleVerification: string;
  bingVerification: string;
  areaServed: Bilingual;
  /** Optional canonical override; SITE_URL is used when empty. */
  canonicalBase: string;
}

export interface SnapshotHome {
  kicker: Bilingual;
  title: Bilingual;
  subtitle: Bilingual;
  terminalLines: string[];
  statsNote: Bilingual;
}

export interface SnapshotContact {
  heading: Bilingual;
  intro: Bilingual;
  responseTime: Bilingual;
  availabilityNote: Bilingual;
  formEnabled: boolean;
  allowFileLinks: boolean;
}

export interface SnapshotPublishing {
  /** Page size for lists. */
  pageSize: number;
  /** Show the "looking for work" banner. */
  hiringBanner: boolean;
  bannerText: Bilingual;
}

export interface SnapshotService {
  slug: string;
  icon: string;
  title: Bilingual;
  summary: Bilingual;
  bodyHtml: Bilingual;
  deliverables: { ar: string; en: string }[];
  priceNote: Bilingual;
  stack: string[];
  sortOrder: number;
}

export interface SnapshotProject {
  slug: string;
  name: Bilingual;
  fullName: string;
  description: Bilingual;
  url: string;
  homepage: string | null;
  topics: string[];
  stars: number;
  forks: number;
  language: string | null;
  languages: { name: string; bytes: number; percent: number }[];
  license: string | null;
  category: string;
  pushedAt: string | null;
  createdAt: string | null;
  featured: boolean;
  visible: boolean;
  archived: boolean;
  isFork: boolean;
  isTemplate: boolean;
  syncState: string;
  docMode: 'readme' | 'single' | 'multi' | 'none';
  docsPath: string;
  docsEntry: string | null;
  docsFileCount: number;
  /** HTML files mirrored into KV, used for the generated sidebar. */
  docsFiles: { path: string; title: string | null; isEntry: boolean }[];
  readmeHtml: string;
  readmeExcerpt: string;
  hasDocs: boolean;
  release: {
    tag: string;
    name: string;
    publishedAt: string | null;
    notesHtml: string;
    downloads: number;
    assets: {
      fileName: string;
      kind: string;
      sizeBytes: number;
      downloadUrl: string;
      downloads: number;
    }[];
  } | null;
  appSlug: string | null;
  sortOrder: number;
}

export interface SnapshotApp {
  slug: string;
  name: Bilingual;
  tagline: Bilingual;
  bodyHtml: Bilingual;
  platform: string;
  requirements: Bilingual;
  installNotes: Bilingual;
  repoFullName: string | null;
  projectSlug: string | null;
  currentVersion: string | null;
  pricing: {
    mode: 'free' | 'paid' | 'donation';
    label: Bilingual;
    details: Bilingual;
    paymentUrl: string;
    paymentMethod: string;
  };
  licenseNote: Bilingual;
  iconUrl: string;
  screenshots: string[];
  features: { ar: string; en: string }[];
  stars: number;
  repoUrl: string | null;
  downloadsCount: number;
  assets: {
    id: number;
    fileName: string;
    label: Bilingual;
    kind: string;
    sizeBytes: number;
    downloadUrl: string;
    downloads: number;
    releaseTag: string;
    releaseNotesHtml: string;
    publishedAt: string | null;
    isCurrent: boolean;
    isPrerelease: boolean;
    checksumSha256: string | null;
  }[];
  visible: boolean;
  featured: boolean;
  sortOrder: number;
  updatedAt: string | null;
}

export interface SnapshotPost {
  slug: string;
  title: Bilingual;
  excerpt: Bilingual;
  bodyHtml: Bilingual;
  coverUrl: string;
  tags: string[];
  readingMinutes: number;
  publishedAt: string | null;
  updatedAt: string | null;
  featured: boolean;
  views: number;
}

export interface SnapshotSkill {
  name: Bilingual;
  category: string;
  level: number;
  note: Bilingual;
  sinceYear: number | null;
  isLearning: boolean;
  learningProgress: number;
  fromGithub: boolean;
  sortOrder: number;
}

export interface SnapshotLearning {
  title: Bilingual;
  summary: Bilingual;
  bodyHtml: Bilingual;
  progress: number;
  startedAt: string | null;
  targetAt: string | null;
  resources: { label: string; url: string }[];
  sortOrder: number;
}

export interface SnapshotExperience {
  role: Bilingual;
  organization: Bilingual;
  location: Bilingual;
  employmentType: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: Bilingual;
  highlights: { ar: string; en: string }[];
  sortOrder: number;
}

export interface SnapshotCredential {
  kind: string;
  title: Bilingual;
  issuer: Bilingual;
  issuedYear: string;
  note: Bilingual;
  url: string;
  sortOrder: number;
}

export interface SnapshotSocial {
  platform: string;
  label: Bilingual;
  url: string;
  handle: string;
  icon: string;
  accent: string;
  sortOrder: number;
}

export interface SnapshotPage {
  slug: string;
  title: Bilingual;
  summary: Bilingual;
  kind: 'single' | 'multi';
  fileCount: number;
  totalBytes: number;
  tags: string[];
  updatedAt: string | null;
}

export interface SnapshotLanguageStat {
  name: string;
  bytes: number;
  percent: number;
  projects: number;
}

export interface ContentSnapshot {
  version: number;
  generatedAt: string;
  site: {
    url: string;
    defaultLocale: Locale;
    locales: Locale[];
    timezone: string;
  };
  profile: SnapshotProfile;
  seo: SnapshotSeo;
  home: SnapshotHome;
  contact: SnapshotContact;
  publishing: SnapshotPublishing;
  services: SnapshotService[];
  projects: SnapshotProject[];
  apps: SnapshotApp[];
  posts: SnapshotPost[];
  skills: SnapshotSkill[];
  learning: SnapshotLearning[];
  experience: SnapshotExperience[];
  credentials: SnapshotCredential[];
  socials: SnapshotSocial[];
  pages: SnapshotPage[];
  languages: SnapshotLanguageStat[];
}

export const SNAPSHOT_VERSION = 1;

/** The three facts that are known for certain, everything else starts empty. */
export const DEFAULT_PROFILE: SnapshotProfile = {
  name: bi('يوسف الحمزي', 'Yousif Alhamzi'),
  headline: bi('مطوّر Python — ويب، أتمتة، وتطبيقات سطح مكتب', 'Python developer — web, automation and desktop apps'),
  summary: bi('', ''),
  yearsExperience: 5,
  selfTaught: true,
  city: bi('', ''),
  country: '',
  countryCode: '',
  regionCode: '',
  latitude: null,
  longitude: null,
  timezone: 'Asia/Riyadh',
  languages: bi('العربية، الإنجليزية', 'Arabic, English'),
  availability: bi('متاح للعمل', 'Open to work'),
  email: '',
  phone: '',
  whatsapp: '',
  githubUsername: 'yswef',
  avatar: '',
  resumeUrl: '',
};

export const DEFAULT_SEO: SnapshotSeo = {
  defaultTitle: bi('يوسف الحمزي — مطوّر Python', 'Yousif Alhamzi — Python developer'),
  defaultDescription: bi('', ''),
  keywords: [],
  ogImage: '/og/home.png',
  twitterHandle: '',
  googleVerification: '',
  bingVerification: '',
  areaServed: bi('', ''),
  canonicalBase: '',
};

export const DEFAULT_HOME: SnapshotHome = {
  kicker: bi('PRTFL // 01', 'PRTFL // 01'),
  title: bi('أبني أدوات تعمل.', 'I build tools that work.'),
  subtitle: bi('', ''),
  terminalLines: [],
  statsNote: bi('', ''),
};

export const DEFAULT_CONTACT: SnapshotContact = {
  heading: bi('طلب عمل أو تعاون', 'Work request or collaboration'),
  intro: bi('', ''),
  responseTime: bi('', ''),
  availabilityNote: bi('', ''),
  formEnabled: true,
  allowFileLinks: false,
};

export const DEFAULT_PUBLISHING: SnapshotPublishing = {
  pageSize: 12,
  hiringBanner: false,
  bannerText: bi('', ''),
};

export function defaultSnapshot(siteUrl = 'https://portfolio.pages.dev'): ContentSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(0).toISOString(),
    site: { url: siteUrl, defaultLocale: 'ar', locales: ['ar', 'en'], timezone: 'Asia/Riyadh' },
    profile: DEFAULT_PROFILE,
    seo: DEFAULT_SEO,
    home: DEFAULT_HOME,
    contact: DEFAULT_CONTACT,
    publishing: DEFAULT_PUBLISHING,
    services: [],
    projects: [],
    apps: [],
    posts: [],
    skills: [],
    learning: [],
    experience: [],
    credentials: [],
    socials: [],
    pages: [],
    languages: [],
  };
}

/** Picks the requested language, falling back to the other one when empty. */
export function pickBilingual(value: Bilingual | undefined | null, locale: Locale): string {
  if (!value) return '';
  const primary = (value[locale] ?? '').trim();
  if (primary) return primary;
  const fallback = locale === 'ar' ? value.en : value.ar;
  return (fallback ?? '').trim();
}

/** Merges partial settings objects coming from the panel with the defaults. */
export function mergeSettings<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (!stored || typeof stored !== 'object') return { ...defaults };
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const current = merged[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = mergeSettings(current as Record<string, unknown>, value);
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}
