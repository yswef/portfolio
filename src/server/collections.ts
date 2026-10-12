/**
 * Declarative description of every editable collection.
 *
 * The control panel talks to one generic endpoint (`/api/admin/collection/:name`)
 * and this table decides which columns exist, how they are validated, how they
 * are ordered and what the panel should render. Adding a field to a module is a
 * one-line change here plus a migration.
 */
import { PROJECT_CATEGORIES } from './classify';
import type { FieldMap } from './validate';

export interface CollectionSpec {
  name: string;
  table: string;
  /** Columns exposed over the API. */
  fields: FieldMap;
  /** Column used as the primary key for update/delete. */
  idColumn: string;
  orderBy: string;
  /** Simple `LIKE` search across these columns. */
  searchColumns: string[];
  /** Columns never overwritten by the sync. */
  syncManaged?: string[];
  /** Columns shown as a short summary in list responses. */
  labelColumn: string;
  /** Marks ownership so the sync can respect manual decisions. */
  flagColumnsOnWrite?: Record<string, string>;
}

const SKILL_CATEGORIES = [
  'backend',
  'web',
  'automation',
  'desktop',
  'wordpress',
  'erp',
  'mobile',
  'security',
  'data',
  'tooling',
  'other',
] as const;

export const COLLECTIONS: Record<string, CollectionSpec> = {
  posts: {
    name: 'posts',
    table: 'posts',
    idColumn: 'id',
    orderBy: 'published_at DESC, id DESC',
    labelColumn: 'title',
    searchColumns: ['title', 'slug', 'excerpt'],
    fields: {
      slug: { type: 'string', required: true, singleLine: true, maxLength: 80 },
      title: { type: 'string', required: true, singleLine: true, maxLength: 200 },
      titleAr: { type: 'string', singleLine: true, maxLength: 200 },
      excerpt: { type: 'text', maxLength: 400 },
      excerptAr: { type: 'text', maxLength: 400 },
      bodyMarkdown: { type: 'text', maxLength: 200_000 },
      bodyMarkdownAr: { type: 'text', maxLength: 200_000 },
      coverUrl: { type: 'string', singleLine: true, maxLength: 500 },
      tags: { type: 'list' },
      status: { type: 'enum', values: ['draft', 'published'], default: 'draft' },
      featured: { type: 'bool', default: false },
      readingMinutes: { type: 'int', min: 1, max: 600 },
      publishedAt: { type: 'int', min: 0 },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  services: {
    name: 'services',
    table: 'services',
    idColumn: 'id',
    orderBy: 'sort_order ASC, id ASC',
    labelColumn: 'title',
    searchColumns: ['title', 'slug'],
    fields: {
      slug: { type: 'string', required: true, singleLine: true, maxLength: 80 },
      icon: { type: 'string', singleLine: true, maxLength: 40, default: 'cube' },
      title: { type: 'string', required: true, singleLine: true, maxLength: 200 },
      titleAr: { type: 'string', singleLine: true, maxLength: 200 },
      summary: { type: 'text', maxLength: 600 },
      summaryAr: { type: 'text', maxLength: 600 },
      bodyMarkdown: { type: 'text', maxLength: 60_000 },
      bodyMarkdownAr: { type: 'text', maxLength: 60_000 },
      deliverables: { type: 'pairs' },
      priceNote: { type: 'text', maxLength: 400 },
      priceNoteAr: { type: 'text', maxLength: 400 },
      stack: { type: 'list' },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  skills: {
    name: 'skills',
    table: 'skills',
    idColumn: 'id',
    orderBy: 'sort_order ASC, level DESC, id ASC',
    labelColumn: 'name',
    searchColumns: ['name', 'name_ar'],
    fields: {
      name: { type: 'string', required: true, singleLine: true, maxLength: 80 },
      nameAr: { type: 'string', singleLine: true, maxLength: 80 },
      category: { type: 'enum', values: SKILL_CATEGORIES, default: 'other' },
      level: { type: 'int', min: 0, max: 100, default: 50 },
      note: { type: 'text', maxLength: 400 },
      noteAr: { type: 'text', maxLength: 400 },
      sinceYear: { type: 'int', min: 1990, max: 2100 },
      isLearning: { type: 'bool', default: false },
      learningProgress: { type: 'int', min: 0, max: 100, default: 0 },
      fromGithub: { type: 'bool', default: false },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  learning: {
    name: 'learning',
    table: 'learning',
    idColumn: 'id',
    orderBy: 'sort_order ASC, id ASC',
    labelColumn: 'title',
    searchColumns: ['title', 'title_ar'],
    fields: {
      title: { type: 'string', required: true, singleLine: true, maxLength: 200 },
      titleAr: { type: 'string', singleLine: true, maxLength: 200 },
      summary: { type: 'text', maxLength: 600 },
      summaryAr: { type: 'text', maxLength: 600 },
      bodyMarkdown: { type: 'text', maxLength: 60_000 },
      bodyMarkdownAr: { type: 'text', maxLength: 60_000 },
      progress: { type: 'int', min: 0, max: 100, default: 0 },
      startedAt: { type: 'string', singleLine: true, maxLength: 20 },
      targetAt: { type: 'string', singleLine: true, maxLength: 20 },
      resources: { type: 'json' },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  experience: {
    name: 'experience',
    table: 'experience',
    idColumn: 'id',
    orderBy: 'sort_order ASC, start_date DESC',
    labelColumn: 'role',
    searchColumns: ['role', 'organization'],
    fields: {
      role: { type: 'string', required: true, singleLine: true, maxLength: 200 },
      roleAr: { type: 'string', singleLine: true, maxLength: 200 },
      organization: { type: 'string', singleLine: true, maxLength: 200 },
      organizationAr: { type: 'string', singleLine: true, maxLength: 200 },
      location: { type: 'string', singleLine: true, maxLength: 120 },
      locationAr: { type: 'string', singleLine: true, maxLength: 120 },
      employmentType: { type: 'string', singleLine: true, maxLength: 60 },
      startDate: { type: 'string', singleLine: true, maxLength: 20 },
      endDate: { type: 'string', singleLine: true, maxLength: 20 },
      isCurrent: { type: 'bool', default: false },
      summary: { type: 'text', maxLength: 1000 },
      summaryAr: { type: 'text', maxLength: 1000 },
      highlights: { type: 'pairs' },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  credentials: {
    name: 'credentials',
    table: 'credentials',
    idColumn: 'id',
    orderBy: 'sort_order ASC, issued_year DESC',
    labelColumn: 'title',
    searchColumns: ['title', 'issuer'],
    fields: {
      kind: { type: 'enum', values: ['education', 'certificate', 'achievement'], default: 'certificate' },
      title: { type: 'string', required: true, singleLine: true, maxLength: 200 },
      titleAr: { type: 'string', singleLine: true, maxLength: 200 },
      issuer: { type: 'string', singleLine: true, maxLength: 200 },
      issuerAr: { type: 'string', singleLine: true, maxLength: 200 },
      issuedYear: { type: 'string', singleLine: true, maxLength: 20 },
      note: { type: 'text', maxLength: 600 },
      noteAr: { type: 'text', maxLength: 600 },
      url: { type: 'string', singleLine: true, maxLength: 500 },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  socials: {
    name: 'socials',
    table: 'social_links',
    idColumn: 'id',
    orderBy: 'sort_order ASC, id ASC',
    labelColumn: 'platform',
    searchColumns: ['platform', 'handle', 'url'],
    fields: {
      platform: { type: 'string', required: true, singleLine: true, maxLength: 40 },
      label: { type: 'string', singleLine: true, maxLength: 80 },
      labelAr: { type: 'string', singleLine: true, maxLength: 80 },
      url: { type: 'string', required: true, singleLine: true, maxLength: 500 },
      handle: { type: 'string', singleLine: true, maxLength: 120 },
      icon: { type: 'string', singleLine: true, maxLength: 40, default: 'link' },
      accent: { type: 'string', singleLine: true, maxLength: 20 },
      visible: { type: 'bool', default: true },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
  apps: {
    name: 'apps',
    table: 'apps',
    idColumn: 'id',
    orderBy: 'featured DESC, sort_order ASC, name ASC',
    labelColumn: 'name',
    searchColumns: ['name', 'slug', 'repo_full_name', 'tagline'],
    syncManaged: ['current_version', 'downloads_count', 'stars_cached'],
    fields: {
      slug: { type: 'string', required: true, singleLine: true, maxLength: 80 },
      name: { type: 'string', required: true, singleLine: true, maxLength: 160 },
      nameAr: { type: 'string', singleLine: true, maxLength: 160 },
      tagline: { type: 'text', maxLength: 300 },
      taglineAr: { type: 'text', maxLength: 300 },
      bodyMarkdown: { type: 'text', maxLength: 120_000 },
      bodyMarkdownAr: { type: 'text', maxLength: 120_000 },
      platform: { type: 'string', singleLine: true, maxLength: 40, default: 'windows' },
      requirements: { type: 'text', maxLength: 1000 },
      requirementsAr: { type: 'text', maxLength: 1000 },
      installNotes: { type: 'text', maxLength: 1000 },
      installNotesAr: { type: 'text', maxLength: 1000 },
      repoFullName: { type: 'string', singleLine: true, maxLength: 160 },
      currentVersion: { type: 'string', singleLine: true, maxLength: 80 },
      pricingMode: { type: 'enum', values: ['free', 'paid', 'donation'], default: 'free' },
      priceLabel: { type: 'string', singleLine: true, maxLength: 80 },
      priceLabelAr: { type: 'string', singleLine: true, maxLength: 80 },
      pricingDetails: { type: 'text', maxLength: 1000 },
      pricingDetailsAr: { type: 'text', maxLength: 1000 },
      paymentUrl: { type: 'string', singleLine: true, maxLength: 500 },
      paymentMethod: { type: 'string', singleLine: true, maxLength: 120 },
      licenseNote: { type: 'text', maxLength: 600 },
      licenseNoteAr: { type: 'text', maxLength: 600 },
      iconUrl: { type: 'string', singleLine: true, maxLength: 500 },
      screenshots: { type: 'list' },
      features: { type: 'pairs' },
      visible: { type: 'bool', default: true },
      featured: { type: 'bool', default: false },
      sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
    },
  },
};

/** Projects are read-mostly: only presentation fields are editable. */
export const PROJECT_FIELDS: FieldMap = {
  slug: { type: 'string', required: true, singleLine: true, maxLength: 80 },
  descriptionAr: { type: 'text', maxLength: 1000 },
  visible: { type: 'bool', default: true },
  featured: { type: 'bool', default: false },
  pinned: { type: 'bool', default: false },
  sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
  category: { type: 'enum', values: PROJECT_CATEGORIES, default: 'other' },
  docMode: { type: 'enum', values: ['readme', 'single', 'multi', 'none'], default: 'readme' },
  docsEntry: { type: 'string', singleLine: true, maxLength: 200 },
};

export const MESSAGE_FIELDS: FieldMap = {
  status: { type: 'enum', values: ['new', 'read', 'archived', 'spam'], default: 'new' },
  adminNote: { type: 'text', maxLength: 2000 },
};

export const PAGE_FIELDS: FieldMap = {
  slug: { type: 'string', required: true, singleLine: true, maxLength: 80 },
  title: { type: 'string', required: true, singleLine: true, maxLength: 200 },
  titleAr: { type: 'string', singleLine: true, maxLength: 200 },
  summary: { type: 'text', maxLength: 600 },
  summaryAr: { type: 'text', maxLength: 600 },
  visibility: { type: 'enum', values: ['private', 'public'], default: 'private' },
  entry: { type: 'string', singleLine: true, maxLength: 200 },
  tags: { type: 'list' },
  visible: { type: 'bool', default: true },
  sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
};

export const ASSET_FIELDS: FieldMap = {
  label: { type: 'string', singleLine: true, maxLength: 120 },
  labelAr: { type: 'string', singleLine: true, maxLength: 120 },
  kind: { type: 'enum', values: ['installer', 'portable', 'checksum', 'source', 'other'], default: 'other' },
  visible: { type: 'bool', default: true },
  sortOrder: { type: 'int', min: -9999, max: 9999, default: 0 },
  checksumSha256: { type: 'string', singleLine: true, maxLength: 128 },
};

/** Settings documents (single JSON blob per key). */
export const SETTINGS_KEYS = ['profile', 'seo', 'home', 'contact', 'publishing'] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];
