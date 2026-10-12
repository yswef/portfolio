/**
 * Database schema for the site (Cloudflare D1 / SQLite).
 *
 * Design notes
 * ------------
 * - D1 is the source of truth for everything that is edited in the control panel
 *   and for visitor/download accounting. The free plan allows 5,000,000 rows read
 *   and 100,000 rows written per day, so hot read paths stay narrow and the public
 *   pages are pre-rendered at build time instead of querying on every view.
 * - Workers KV is used only for page/document bodies (HTML blobs), because the free
 *   plan allows just 1,000 writes per day. Numbers and metadata always live here.
 * - JSON columns hold small structures only (topic lists, UTM payloads, ...).
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch())`;

/* ------------------------------------------------------------------ settings */

/** Generic key/value store for singleton settings documents (profile, SEO, ...). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

/* ------------------------------------------------------------------ projects */

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    githubId: integer('github_id').notNull(),
    fullName: text('full_name').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    descriptionAr: text('description_ar'),
    htmlUrl: text('html_url').notNull(),
    homepage: text('homepage'),
    topics: text('topics', { mode: 'json' }).$type<string[]>().notNull().default([]),
    stars: integer('stars').notNull().default(0),
    forks: integer('forks').notNull().default(0),
    watchers: integer('watchers').notNull().default(0),
    openIssues: integer('open_issues').notNull().default(0),
    primaryLanguage: text('primary_language'),
    /** Aggregated language bytes: [{ name, bytes, percent }] */
    languages: text('languages', { mode: 'json' })
      .$type<{ name: string; bytes: number; percent: number }[]>()
      .notNull()
      .default([]),
    license: text('license'),
    isFork: integer('is_fork', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
    repoCreatedAt: text('repo_created_at'),
    repoPushedAt: text('repo_pushed_at'),
    sizeKb: integer('size_kb').notNull().default(0),
    defaultBranch: text('default_branch').notNull().default('main'),
    /** README markdown as fetched from GitHub (rendered + sanitised at build time). */
    readmeMarkdown: text('readme_markdown'),
    readmeEtag: text('readme_etag'),
    readmeFetchedAt: integer('readme_fetched_at'),
    hasDocs: integer('has_docs', { mode: 'boolean' }).notNull().default(false),
    /** Detected documentation layout: readme | single | multi | none */
    detectedDocMode: text('detected_doc_mode').notNull().default('readme'),
    /** Effective (possibly overridden) documentation mode. */
    docMode: text('doc_mode').notNull().default('readme'),
    /** True once the owner changes the documentation mode from the panel. */
    docModeOverridden: integer('doc_mode_overridden', { mode: 'boolean' }).notNull().default(false),
    docsPath: text('docs_path').notNull().default('docs'),
    docsEntry: text('docs_entry'),
    docsFileCount: integer('docs_file_count').notNull().default(0),
    docsSyncedAt: integer('docs_synced_at'),
    /** Raw `.portfolio.json` override file, when the repository ships one. */
    override: text('override', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    overrideTitle: text('override_title'),
    overrideTitleAr: text('override_title_ar'),
    overrideCategory: text('override_category'),
    overrideSummaryAr: text('override_summary_ar'),
    overrideSummaryEn: text('override_summary_en'),
    overrideFeatured: integer('override_featured', { mode: 'boolean' }),
    overrideHidden: integer('override_hidden', { mode: 'boolean' }),
    category: text('category').notNull().default('other'),
    /** True once the owner picks a category in the panel (sync stops overwriting it). */
    categoryOverridden: integer('category_overridden', { mode: 'boolean' }).notNull().default(false),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Manual pinning: higher value wins, 0 means "use recency". */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    latestReleaseTag: text('latest_release_tag'),
    latestReleaseName: text('latest_release_name'),
    latestReleaseAt: text('latest_release_at'),
    latestReleaseNotes: text('latest_release_notes'),
    releasesCount: integer('releases_count').notNull().default(0),
    releaseDownloads: integer('release_downloads').notNull().default(0),
    syncedAt: integer('synced_at'),
    /** active | missing — `missing` means the repository is gone or private now. */
    syncState: text('sync_state').notNull().default('active'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('projects_github_id_idx').on(t.githubId),
    uniqueIndex('projects_slug_idx').on(t.slug),
    index('projects_visibility_idx').on(t.visible, t.featured, t.sortOrder),
    index('projects_pushed_idx').on(t.repoPushedAt),
  ],
);

/* ---------------------------------------------------------------------- apps */

export const apps = sqliteTable(
  'apps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    tagline: text('tagline'),
    taglineAr: text('tagline_ar'),
    bodyMarkdown: text('body_markdown'),
    bodyMarkdownAr: text('body_markdown_ar'),
    platform: text('platform').notNull().default('windows'),
    requirements: text('requirements'),
    requirementsAr: text('requirements_ar'),
    installNotes: text('install_notes'),
    installNotesAr: text('install_notes_ar'),
    repoFullName: text('repo_full_name'),
    currentVersion: text('current_version'),
    /** free | paid */
    pricingMode: text('pricing_mode').notNull().default('free'),
    priceLabel: text('price_label'),
    priceLabelAr: text('price_label_ar'),
    pricingDetails: text('pricing_details'),
    pricingDetailsAr: text('pricing_details_ar'),
    paymentUrl: text('payment_url'),
    paymentMethod: text('payment_method'),
    licenseNote: text('license_note'),
    licenseNoteAr: text('license_note_ar'),
    iconUrl: text('icon_url'),
    screenshots: text('screenshots', { mode: 'json' }).$type<string[]>().notNull().default([]),
    features: text('features', { mode: 'json' })
      .$type<{ en: string; ar: string }[]>()
      .notNull()
      .default([]),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    /** True when the sync created the row from a release; the panel can edit it. */
    autoCreated: integer('auto_created', { mode: 'boolean' }).notNull().default(false),
    /** Set from the panel to stop the sync from re-creating an app it deleted. */
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    downloadsCount: integer('downloads_count').notNull().default(0),
    starsCached: integer('stars_cached').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('apps_slug_idx').on(t.slug),
    index('apps_visibility_idx').on(t.visible, t.sortOrder),
  ],
);

export const appAssets = sqliteTable(
  'app_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Owning app row (created automatically from a repository release). */
    appId: integer('app_id').notNull(),
    /** Repository the asset came from, when it was synced from GitHub. */
    projectId: integer('project_id'),
    githubAssetId: integer('github_asset_id'),
    releaseTag: text('release_tag').notNull(),
    releaseName: text('release_name'),
    fileName: text('file_name').notNull(),
    label: text('label'),
    labelAr: text('label_ar'),
    /** installer | portable | checksum | source | other */
    kind: text('kind').notNull().default('other'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    downloadUrl: text('download_url').notNull(),
    checksumSha256: text('checksum_sha256'),
    releaseNotes: text('release_notes'),
    releasePublishedAt: text('release_published_at'),
    isPrerelease: integer('is_prerelease', { mode: 'boolean' }).notNull().default(false),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    downloads: integer('downloads').notNull().default(0),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('app_assets_unique_idx').on(t.appId, t.releaseTag, t.fileName),
    index('app_assets_app_idx').on(t.appId, t.isCurrent),
    index('app_assets_project_idx').on(t.projectId),
  ],
);

/* ------------------------------------------------------------------ downloads */

export const downloads = sqliteTable(
  'downloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    appId: integer('app_id'),
    assetId: integer('asset_id'),
    projectId: integer('project_id'),
    slug: text('slug').notNull(),
    fileName: text('file_name'),
    releaseTag: text('release_tag'),
    visitorId: text('visitor_id'),
    country: text('country'),
    city: text('city'),
    region: text('region'),
    timezone: text('timezone'),
    device: text('device'),
    browser: text('browser'),
    os: text('os'),
    referrer: text('referrer'),
    referrerHost: text('referrer_host'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    ipHash: text('ip_hash'),
    isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('downloads_created_idx').on(t.createdAt),
    index('downloads_app_idx').on(t.appId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ editorial */

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    excerpt: text('excerpt'),
    excerptAr: text('excerpt_ar'),
    bodyMarkdown: text('body_markdown'),
    bodyMarkdownAr: text('body_markdown_ar'),
    coverUrl: text('cover_url'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** draft | published */
    status: text('status').notNull().default('draft'),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    publishedAt: integer('published_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    views: integer('views').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('posts_slug_idx').on(t.slug),
    index('posts_status_idx').on(t.status, t.publishedAt),
  ],
);

export const services = sqliteTable(
  'services',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    icon: text('icon').notNull().default('cube'),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    summary: text('summary'),
    summaryAr: text('summary_ar'),
    bodyMarkdown: text('body_markdown'),
    bodyMarkdownAr: text('body_markdown_ar'),
    deliverables: text('deliverables', { mode: 'json' })
      .$type<{ en: string; ar: string }[]>()
      .notNull()
      .default([]),
    priceNote: text('price_note'),
    priceNoteAr: text('price_note_ar'),
    stack: text('stack', { mode: 'json' }).$type<string[]>().notNull().default([]),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('services_slug_idx').on(t.slug)],
);

export const skills = sqliteTable(
  'skills',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    /** backend | web | automation | desktop | wordpress | erp | mobile | security | data | tooling | other */
    category: text('category').notNull().default('other'),
    /** Self-declared strength, 0-100. Shown as a meter, not as a fake percentage. */
    level: integer('level').notNull().default(50),
    note: text('note'),
    noteAr: text('note_ar'),
    sinceYear: integer('since_year'),
    isLearning: integer('is_learning', { mode: 'boolean' }).notNull().default(false),
    learningProgress: integer('learning_progress').notNull().default(0),
    fromGithub: integer('from_github', { mode: 'boolean' }).notNull().default(false),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('skills_name_idx').on(t.name), index('skills_category_idx').on(t.category)],
);

/** "Currently learning" entries — separate from skills so they can carry progress. */
export const learning = sqliteTable(
  'learning',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    summary: text('summary'),
    summaryAr: text('summary_ar'),
    bodyMarkdown: text('body_markdown'),
    bodyMarkdownAr: text('body_markdown_ar'),
    progress: integer('progress').notNull().default(0),
    startedAt: text('started_at'),
    targetAt: text('target_at'),
    resources: text('resources', { mode: 'json' })
      .$type<{ label: string; url: string }[]>()
      .notNull()
      .default([]),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('learning_visible_idx').on(t.visible, t.sortOrder)],
);

/** Experience timeline shown on the résumé page. */
export const experience = sqliteTable(
  'experience',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    role: text('role').notNull(),
    roleAr: text('role_ar'),
    organization: text('organization'),
    organizationAr: text('organization_ar'),
    location: text('location'),
    locationAr: text('location_ar'),
    employmentType: text('employment_type'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    summary: text('summary'),
    summaryAr: text('summary_ar'),
    highlights: text('highlights', { mode: 'json' })
      .$type<{ en: string; ar: string }[]>()
      .notNull()
      .default([]),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('experience_visible_idx').on(t.visible, t.sortOrder)],
);

/** Degrees, diplomas and certificates (diploma, ICDL, ...). */
export const credentials = sqliteTable(
  'credentials',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** education | certificate | achievement */
    kind: text('kind').notNull().default('certificate'),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    issuer: text('issuer'),
    issuerAr: text('issuer_ar'),
    issuedYear: text('issued_year'),
    note: text('note'),
    noteAr: text('note_ar'),
    url: text('url'),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('credentials_visible_idx').on(t.visible, t.sortOrder)],
);

export const socialLinks = sqliteTable(
  'social_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platform: text('platform').notNull(),
    label: text('label'),
    labelAr: text('label_ar'),
    url: text('url').notNull(),
    handle: text('handle'),
    icon: text('icon').notNull().default('link'),
    accent: text('accent'),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('social_visible_idx').on(t.visible, t.sortOrder)],
);

/* ------------------------------------------------------------------- messages */

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    company: text('company'),
    projectType: text('project_type'),
    budget: text('budget'),
    subject: text('subject'),
    body: text('body').notNull(),
    locale: text('locale').notNull().default('ar'),
    /** new | read | archived | spam */
    status: text('status').notNull().default('new'),
    country: text('country'),
    city: text('city'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    visitorId: text('visitor_id'),
    turnstileOk: integer('turnstile_ok', { mode: 'boolean' }).notNull().default(false),
    adminNote: text('admin_note'),
    repliedAt: integer('replied_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('messages_status_idx').on(t.status, t.createdAt)],
);

/* ------------------------------------------------------- private teaching pages */

export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    titleAr: text('title_ar'),
    summary: text('summary'),
    summaryAr: text('summary_ar'),
    /** private (owner only) | public */
    visibility: text('visibility').notNull().default('private'),
    /** single | multi */
    kind: text('kind').notNull().default('single'),
    entry: text('entry').notNull().default('index.html'),
    kvPrefix: text('kv_prefix').notNull(),
    fileCount: integer('file_count').notNull().default(0),
    totalBytes: integer('total_bytes').notNull().default(0),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** How the content was produced: upload | zip | manual */
    source: text('source').notNull().default('upload'),
    views: integer('views').notNull().default(0),
    lastViewedAt: integer('last_viewed_at'),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('pages_slug_idx').on(t.slug),
    index('pages_visibility_idx').on(t.visibility, t.sortOrder),
  ],
);

/** File index for KV-stored documents (teaching pages and repository docs). */
export const files = sqliteTable(
  'files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** page | project-docs */
    scope: text('scope').notNull(),
    ownerId: integer('owner_id'),
    ownerKey: text('owner_key').notNull(),
    path: text('path').notNull(),
    kvKey: text('kv_key').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    sha256: text('sha256'),
    isEntry: integer('is_entry', { mode: 'boolean' }).notNull().default(false),
    title: text('title'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('files_unique_idx').on(t.scope, t.ownerKey, t.path),
    index('files_owner_idx').on(t.scope, t.ownerId),
  ],
);

/* ----------------------------------------------------------------------- auth */

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    /** pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64> */
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    totpSecret: text('totp_secret'),
    totpEnabledAt: integer('totp_enabled_at'),
    totpLastCounter: integer('totp_last_counter'),
    recoveryCodes: text('recovery_codes', { mode: 'json' }).$type<string[]>().notNull().default([]),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    lastLoginCountry: text('last_login_country'),
    lastLoginIpHash: text('last_login_ip_hash'),
    passwordChangedAt: integer('password_changed_at'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('users_username_idx').on(t.username)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id'),
    /** half | full — `half` means the password step passed but TOTP is pending. */
    stage: text('stage').notNull().default('half'),
    csrfToken: text('csrf_token').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    country: text('country'),
    createdAt: integer('created_at').notNull().default(now),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('sessions_expiry_idx').on(t.expiresAt), index('sessions_user_idx').on(t.userId)],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username'),
    ipHash: text('ip_hash'),
    stage: text('stage').notNull().default('password'),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    reason: text('reason'),
    country: text('country'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('login_attempts_idx').on(t.createdAt), index('login_attempts_ip_idx').on(t.ipHash)],
);

/* ------------------------------------------------------------------ analytics */

export const visits = sqliteTable(
  'visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    visitorId: text('visitor_id').notNull(),
    sessionId: text('session_id').notNull(),
    entryPath: text('entry_path').notNull(),
    lastPath: text('last_path').notNull(),
    locale: text('locale').notNull().default('ar'),
    country: text('country'),
    countryName: text('country_name'),
    city: text('city'),
    region: text('region'),
    timezone: text('timezone'),
    asn: integer('asn'),
    asOrganization: text('as_organization'),
    continent: text('continent'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    /** desktop | mobile | tablet | bot */
    device: text('device'),
    deviceModel: text('device_model'),
    browser: text('browser'),
    browserVersion: text('browser_version'),
    os: text('os'),
    osVersion: text('os_version'),
    userAgent: text('user_agent'),
    language: text('language'),
    screenWidth: integer('screen_width'),
    screenHeight: integer('screen_height'),
    viewportWidth: integer('viewport_width'),
    viewportHeight: integer('viewport_height'),
    referrer: text('referrer'),
    referrerHost: text('referrer_host'),
    /** search | social | direct | internal | referral | campaign */
    sourceType: text('source_type'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    ipHash: text('ip_hash'),
    isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
    pageviews: integer('pageviews').notNull().default(1),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    startedAt: integer('started_at').notNull().default(now),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
  },
  (t) => [
    index('visits_started_idx').on(t.startedAt),
    index('visits_seen_idx').on(t.lastSeenAt),
    index('visits_visitor_idx').on(t.visitorId),
    index('visits_country_idx').on(t.country),
  ],
);

export const pageviews = sqliteTable(
  'pageviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    visitId: integer('visit_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    path: text('path').notNull(),
    title: text('title'),
    locale: text('locale').notNull().default('ar'),
    /** A stable key used for grouping dynamic routes, e.g. `/apps/[slug]`. */
    routeKey: text('route_key'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    maxScroll: integer('max_scroll').notNull().default(0),
    isExit: integer('is_exit', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('pageviews_visit_idx').on(t.visitId),
    index('pageviews_path_idx').on(t.path, t.createdAt),
    index('pageviews_created_idx').on(t.createdAt),
  ],
);

/* --------------------------------------------------------------- sync + infrastructure */

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** cron | webhook | manual | cli */
    trigger: text('trigger').notNull().default('cron'),
    status: text('status').notNull().default('running'),
    startedAt: integer('started_at').notNull().default(now),
    finishedAt: integer('finished_at'),
    durationMs: integer('duration_ms'),
    reposSeen: integer('repos_seen').notNull().default(0),
    reposCreated: integer('repos_created').notNull().default(0),
    reposUpdated: integer('repos_updated').notNull().default(0),
    releasesSeen: integer('releases_seen').notNull().default(0),
    assetsSeen: integer('assets_seen').notNull().default(0),
    docsSynced: integer('docs_synced').notNull().default(0),
    webhooksRegistered: integer('webhooks_registered').notNull().default(0),
    kvWrites: integer('kv_writes').notNull().default(0),
    snapshotCommit: text('snapshot_commit'),
    error: text('error'),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  },
  (t) => [index('sync_runs_started_idx').on(t.startedAt)],
);

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoFullName: text('repo_full_name').notNull(),
    hookId: integer('hook_id'),
    url: text('url'),
    events: text('events', { mode: 'json' }).$type<string[]>().notNull().default([]),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    lastDeliveryAt: integer('last_delivery_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('webhooks_repo_idx').on(t.repoFullName)],
);

/** Durable rate limiting (survives isolate recycling, unlike in-memory counters). */
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    hits: integer('hits').notNull().default(0),
    windowStart: integer('window_start').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
);

/** Short-lived one-time tokens (GitHub OAuth state, star consent, ...). */
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (t) => [index('oauth_states_expiry_idx').on(t.expiresAt)],
);

/** Audit trail of control-panel actions — one row per change. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    ipHash: text('ip_hash'),
    country: text('country'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

/** Failed or rejected public submissions, kept for abuse review. */
export const abuseLog = sqliteTable(
  'abuse_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    ipHash: text('ip_hash'),
    visitorId: text('visitor_id'),
    detail: text('detail'),
    country: text('country'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('abuse_created_idx').on(t.createdAt)],
);
