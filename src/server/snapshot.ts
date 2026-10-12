/**
 * Builds `content/snapshot.json` — the document the pre-rendered site is built
 * from. It is produced inside the Worker (during a sync pass) and committed to
 * the repository, which triggers a Cloudflare Pages build. That is what makes a
 * new repository or a new release appear on the site automatically, without a
 * server rendering pages on every request.
 *
 * Sizes are capped per item so the snapshot stays small (a few hundred KB) and
 * the build stays fast.
 */
import { adminPath, siteUrl, type Env } from './env';
import { pickBilingual, SNAPSHOT_VERSION, defaultSnapshot, mergeSettings, type ContentSnapshot, type Locale } from './content-types';
import { plainText, renderMarkdown, readingMinutes } from './markdown';
import { resolveRepoUrl } from './github';

const MAX_BODY_CHARS = 120_000;

export function snapshotCommitPath(): string {
  return 'content/snapshot.json';
}

function secondsToIso(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface SettingsRow {
  key: string;
  value: Record<string, unknown> | null;
}

async function readSettings(env: Env): Promise<Record<string, any>> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<SettingsRow>();
  const out: Record<string, any> = {};
  for (const row of rows.results ?? []) out[row.key] = row.value;
  return out;
}

interface Row {
  [key: string]: any;
}

/** Everything public, in one document. */
export async function buildSnapshot(env: Env, options: { username?: string } = {}): Promise<ContentSnapshot> {
  const snapshot = defaultSnapshot(siteUrl(env));
  const settings = await readSettings(env);

  const profile = mergeSettings(snapshot.profile as unknown as Record<string, unknown>, settings.profile);
  profile.githubUsername = options.username ?? (profile as any).githubUsername ?? 'yswef';
  snapshot.profile = profile as unknown as ContentSnapshot['profile'];
  snapshot.seo = mergeSettings(snapshot.seo as unknown as Record<string, unknown>, settings.seo) as unknown as ContentSnapshot['seo'];
  snapshot.home = mergeSettings(snapshot.home as unknown as Record<string, unknown>, settings.home) as unknown as ContentSnapshot['home'];
  snapshot.contact = mergeSettings(snapshot.contact as unknown as Record<string, unknown>, settings.contact) as unknown as ContentSnapshot['contact'];
  snapshot.publishing = mergeSettings(snapshot.publishing as unknown as Record<string, unknown>, settings.publishing) as unknown as ContentSnapshot['publishing'];

  /* ------------------------------------------------------------- projects */
  const projectRows = await env.DB.prepare(
    `SELECT * FROM projects
      WHERE sync_state = 'active' OR visible = 1
      ORDER BY featured DESC, sort_order ASC, COALESCE(repo_pushed_at, '') DESC`,
  ).all<Row>();

  const appRows = await env.DB.prepare('SELECT * FROM apps ORDER BY featured DESC, sort_order ASC, name ASC').all<Row>();
  const assetRows = await env.DB.prepare(
    'SELECT * FROM app_assets WHERE visible = 1 ORDER BY is_current DESC, release_published_at DESC, sort_order ASC',
  ).all<Row>();

  const assetsByProject = new Map<number, Row[]>();
  const assetsByApp = new Map<number, Row[]>();
  for (const asset of assetRows.results ?? []) {
    const projectId = asset.app_id as number | null;
    if (projectId) {
      const list = assetsByProject.get(projectId) ?? [];
      list.push(asset);
      assetsByProject.set(projectId, list);
    }
  }

  const localePairs: Locale[] = ['ar', 'en'];

  const projects: ContentSnapshot['projects'] = (projectRows.results ?? []).map((row) => {
    const releaseAssets = (assetsByProject.get(row.id) ?? []).slice(0, 12);
    const readmeHtml = row.readme_markdown
      ? renderMarkdown((row.readme_markdown as string).slice(0, MAX_BODY_CHARS), {
          resolveUrl: (href, kind) => resolveRepoUrl(row.full_name, row.default_branch ?? 'main', href, kind),
          headingPrefix: `r${row.id}`,
        })
      : '';
    return {
      slug: row.slug,
      name: {
        ar: asString(row.override_title_ar) || asString(row.override_title) || row.name,
        en: asString(row.override_title) || row.name,
      },
      fullName: row.full_name,
      description: {
        ar: asString(row.override_summary_ar) || asString(row.description) || '',
        en: asString(row.override_summary_en) || asString(row.description) || '',
      },
      url: row.html_url,
      homepage: row.homepage ?? null,
      topics: (row.topics as string[]) ?? [],
      stars: asNumber(row.stars),
      forks: asNumber(row.forks),
      language: row.primary_language ?? null,
      languages: (row.languages as { name: string; bytes: number; percent: number }[]) ?? [],
      license: row.license ?? null,
      category: row.override_category ?? row.category ?? 'other',
      pushedAt: row.repo_pushed_at ?? null,
      createdAt: row.repo_created_at ?? null,
      featured: Boolean(row.featured),
      visible: Boolean(row.visible),
      archived: Boolean(row.is_archived),
      isFork: Boolean(row.is_fork),
      isTemplate: Boolean(row.is_template),
      syncState: row.sync_state ?? 'active',
      docMode: (row.doc_mode as 'readme' | 'single' | 'multi' | 'none') ?? 'readme',
      docsPath: row.docs_path ?? 'docs',
      docsEntry: row.docs_entry ?? null,
      docsFileCount: asNumber(row.docs_file_count),
      readmeHtml,
      readmeExcerpt: plainText(row.readme_markdown ?? row.description ?? '', 180),
      hasDocs: Boolean(row.has_docs),
      release: row.latest_release_tag
        ? {
            tag: row.latest_release_tag,
            name: row.latest_release_name ?? row.latest_release_tag,
            publishedAt: row.latest_release_at ?? null,
            notesHtml: row.latest_release_notes
              ? renderMarkdown((row.latest_release_notes as string).slice(0, 20_000))
              : '',
            downloads: releaseAssets.reduce((sum, asset) => sum + asNumber(asset.downloads), 0),
            assets: releaseAssets.map((asset) => ({
              fileName: asset.file_name,
              kind: asset.kind,
              sizeBytes: asNumber(asset.size_bytes),
              downloadUrl: asset.download_url,
              downloads: asNumber(asset.downloads),
            })),
          }
        : null,
      appSlug: null,
      sortOrder: asNumber(row.sort_order),
    };
  });

  /* ----------------------------------------------------------------- apps */
  const apps: ContentSnapshot['apps'] = (appRows.results ?? []).map((row) => {
    const assets = (assetsByApp.get(row.id) ?? []).length
      ? (assetsByApp.get(row.id) as Row[])
      : assetsByProject.get(row.project_id) ?? [];
    const project = projects.find((candidate) => candidate.slug === row.project_slug) ??
      projects.find((candidate) => candidate.fullName === row.repo_full_name);
    return {
      slug: row.slug,
      name: { ar: row.name_ar || row.name, en: row.name },
      tagline: { ar: row.tagline_ar || row.tagline || '', en: row.tagline || '' },
      bodyHtml: {
        ar: row.body_markdown_ar ? renderMarkdown(row.body_markdown_ar.slice(0, MAX_BODY_CHARS)) : '',
        en: row.body_markdown ? renderMarkdown(row.body_markdown.slice(0, MAX_BODY_CHARS)) : '',
      },
      platform: row.platform ?? 'windows',
      requirements: { ar: row.requirements_ar || row.requirements || '', en: row.requirements || '' },
      installNotes: { ar: row.install_notes_ar || row.install_notes || '', en: row.install_notes || '' },
      repoFullName: row.repo_full_name ?? project?.fullName ?? null,
      projectSlug: project?.slug ?? null,
      currentVersion: row.current_version ?? null,
      pricing: {
        mode: (row.pricing_mode as 'free' | 'paid' | 'donation') ?? 'free',
        label: { ar: row.price_label_ar || row.price_label || '', en: row.price_label || '' },
        details: { ar: row.pricing_details_ar || row.pricing_details || '', en: row.pricing_details || '' },
        paymentUrl: row.payment_url ?? '',
        paymentMethod: row.payment_method ?? '',
      },
      licenseNote: { ar: row.license_note_ar || row.license_note || '', en: row.license_note || '' },
      iconUrl: row.icon_url ?? '',
      screenshots: (row.screenshots as string[]) ?? [],
      features: (row.features as { ar: string; en: string }[]) ?? [],
      stars: project?.stars ?? asNumber(row.stars_cached),
      repoUrl: project?.url ?? (row.repo_full_name ? `https://github.com/${row.repo_full_name}` : null),
      downloadsCount: asNumber(row.downloads_count),
      assets: assets.slice(0, 20).map((asset) => ({
        id: asNumber(asset.id),
        fileName: asset.file_name,
        label: { ar: asset.label_ar || asset.label || '', en: asset.label || '' },
        kind: asset.kind ?? 'other',
        sizeBytes: asNumber(asset.size_bytes),
        downloadUrl: asset.download_url,
        downloads: asNumber(asset.downloads),
        releaseTag: asset.release_tag,
        releaseNotesHtml: asset.release_notes ? renderMarkdown((asset.release_notes as string).slice(0, 12_000)) : '',
        publishedAt: asset.release_published_at ?? null,
        isCurrent: Boolean(asset.is_current),
        isPrerelease: Boolean(asset.is_prerelease),
        checksumSha256: asset.checksum_sha256 ?? null,
      })),
      visible: Boolean(row.visible),
      featured: Boolean(row.featured),
      sortOrder: asNumber(row.sort_order),
      updatedAt: secondsToIso(asNumber(row.updated_at) || null),
    };
  });
  void localePairs;

  /* ------------------------------------------------------------ editorial */
  const postRows = await env.DB.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC, id DESC",
  ).all<Row>();
  const posts: ContentSnapshot['posts'] = (postRows.results ?? []).map((row) => ({
    slug: row.slug,
    title: { ar: row.title_ar || row.title, en: row.title },
    excerpt: { ar: row.excerpt_ar || row.excerpt || '', en: row.excerpt || '' },
    bodyHtml: {
      ar: row.body_markdown_ar ? renderMarkdown(row.body_markdown_ar.slice(0, MAX_BODY_CHARS)) : '',
      en: row.body_markdown ? renderMarkdown(row.body_markdown.slice(0, MAX_BODY_CHARS)) : '',
    },
    coverUrl: row.cover_url ?? '',
    tags: (row.tags as string[]) ?? [],
    readingMinutes: asNumber(row.reading_minutes) || readingMinutes(row.body_markdown),
    publishedAt: secondsToIso(asNumber(row.published_at) || null),
    updatedAt: secondsToIso(asNumber(row.updated_at) || null),
    featured: Boolean(row.featured),
    views: asNumber(row.views),
  }));

  const serviceRows = await env.DB.prepare(
    'SELECT * FROM services WHERE visible = 1 ORDER BY sort_order ASC, id ASC',
  ).all<Row>();
  const services: ContentSnapshot['services'] = (serviceRows.results ?? []).map((row) => ({
    slug: row.slug,
    icon: row.icon ?? 'cube',
    title: { ar: row.title_ar || row.title, en: row.title },
    summary: { ar: row.summary_ar || row.summary || '', en: row.summary || '' },
    bodyHtml: {
      ar: row.body_markdown_ar ? renderMarkdown(row.body_markdown_ar.slice(0, MAX_BODY_CHARS)) : '',
      en: row.body_markdown ? renderMarkdown(row.body_markdown.slice(0, MAX_BODY_CHARS)) : '',
    },
    deliverables: (row.deliverables as { ar: string; en: string }[]) ?? [],
    priceNote: { ar: row.price_note_ar || row.price_note || '', en: row.price_note || '' },
    stack: (row.stack as string[]) ?? [],
    sortOrder: asNumber(row.sort_order),
  }));

  const skillRows = await env.DB.prepare(
    'SELECT * FROM skills WHERE visible = 1 ORDER BY category ASC, sort_order ASC, level DESC',
  ).all<Row>();
  const skills: ContentSnapshot['skills'] = (skillRows.results ?? []).map((row) => ({
    name: { ar: row.name_ar || row.name, en: row.name },
    category: row.category ?? 'other',
    level: asNumber(row.level, 50),
    note: { ar: row.note_ar || row.note || '', en: row.note || '' },
    sinceYear: row.since_year ?? null,
    isLearning: Boolean(row.is_learning),
    learningProgress: asNumber(row.learning_progress),
    fromGithub: Boolean(row.from_github),
    sortOrder: asNumber(row.sort_order),
  }));

  const learningRows = await env.DB.prepare(
    'SELECT * FROM learning WHERE visible = 1 ORDER BY sort_order ASC, id ASC',
  ).all<Row>();
  const learning: ContentSnapshot['learning'] = (learningRows.results ?? []).map((row) => ({
    title: { ar: row.title_ar || row.title, en: row.title },
    summary: { ar: row.summary_ar || row.summary || '', en: row.summary || '' },
    bodyHtml: {
      ar: row.body_markdown_ar ? renderMarkdown(row.body_markdown_ar.slice(0, MAX_BODY_CHARS)) : '',
      en: row.body_markdown ? renderMarkdown(row.body_markdown.slice(0, MAX_BODY_CHARS)) : '',
    },
    progress: asNumber(row.progress),
    startedAt: row.started_at ?? null,
    targetAt: row.target_at ?? null,
    resources: (row.resources as { label: string; url: string }[]) ?? [],
    sortOrder: asNumber(row.sort_order),
  }));

  const experienceRows = await env.DB.prepare(
    'SELECT * FROM experience WHERE visible = 1 ORDER BY sort_order ASC, start_date DESC',
  ).all<Row>();
  const experience: ContentSnapshot['experience'] = (experienceRows.results ?? []).map((row) => ({
    role: { ar: row.role_ar || row.role, en: row.role },
    organization: { ar: row.organization_ar || row.organization || '', en: row.organization || '' },
    location: { ar: row.location_ar || row.location || '', en: row.location || '' },
    employmentType: row.employment_type ?? '',
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    isCurrent: Boolean(row.is_current),
    summary: { ar: row.summary_ar || row.summary || '', en: row.summary || '' },
    highlights: (row.highlights as { ar: string; en: string }[]) ?? [],
    sortOrder: asNumber(row.sort_order),
  }));

  const credentialRows = await env.DB.prepare(
    'SELECT * FROM credentials WHERE visible = 1 ORDER BY sort_order ASC, issued_year DESC',
  ).all<Row>();
  const credentials: ContentSnapshot['credentials'] = (credentialRows.results ?? []).map((row) => ({
    kind: row.kind ?? 'certificate',
    title: { ar: row.title_ar || row.title, en: row.title },
    issuer: { ar: row.issuer_ar || row.issuer || '', en: row.issuer || '' },
    issuedYear: row.issued_year ?? '',
    note: { ar: row.note_ar || row.note || '', en: row.note || '' },
    url: row.url ?? '',
    sortOrder: asNumber(row.sort_order),
  }));

  const socialRows = await env.DB.prepare(
    'SELECT * FROM social_links WHERE visible = 1 ORDER BY sort_order ASC, id ASC',
  ).all<Row>();
  const socials: ContentSnapshot['socials'] = (socialRows.results ?? []).map((row) => ({
    platform: row.platform,
    label: { ar: row.label_ar || row.label || row.platform, en: row.label || row.platform },
    url: row.url,
    handle: row.handle ?? '',
    icon: row.icon ?? 'link',
    accent: row.accent ?? '',
    sortOrder: asNumber(row.sort_order),
  }));

  const pageRows = await env.DB.prepare(
    "SELECT slug, title, title_ar, summary, summary_ar, kind, file_count, total_bytes, tags, updated_at FROM pages WHERE visibility = 'public' AND visible = 1 ORDER BY sort_order ASC, id ASC",
  ).all<Row>();
  const pages: ContentSnapshot['pages'] = (pageRows.results ?? []).map((row) => ({
    slug: row.slug,
    title: { ar: row.title_ar || row.title, en: row.title },
    summary: { ar: row.summary_ar || row.summary || '', en: row.summary || '' },
    kind: (row.kind as 'single' | 'multi') ?? 'single',
    fileCount: asNumber(row.file_count),
    totalBytes: asNumber(row.total_bytes),
    tags: (row.tags as string[]) ?? [],
    updatedAt: secondsToIso(asNumber(row.updated_at) || null),
  }));

  /* ------------------------------------------- languages aggregated (GitHub) */
  const totals = new Map<string, { bytes: number; projects: number }>();
  for (const project of projects) {
    if (project.isFork) continue;
    for (const language of project.languages) {
      const entry = totals.get(language.name) ?? { bytes: 0, projects: 0 };
      entry.bytes += language.bytes;
      entry.bytes > 0 && (entry.projects += 0);
      totals.set(language.name, entry);
      if (language.percent > 0) entry.projects += 1;
    }
  }
  const totalBytes = [...totals.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  snapshot.languages = [...totals.entries()]
    .map(([name, entry]) => ({
      name,
      bytes: entry.bytes,
      percent: totalBytes > 0 ? Math.round((entry.bytes / totalBytes) * 1000) / 10 : 0,
      projects: entry.projects,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);

  snapshot.projects = projects;
  snapshot.apps = apps;
  snapshot.posts = posts;
  snapshot.services = services;
  snapshot.skills = skills;
  snapshot.learning = learning;
  snapshot.experience = experience;
  snapshot.credentials = credentials;
  snapshot.socials = socials;
  snapshot.pages = pages;
  snapshot.site.url = snapshot.seo.canonicalBase || siteUrl(env);
  snapshot.version = SNAPSHOT_VERSION;
  snapshot.generatedAt = new Date().toISOString();
  void adminPath;
  void pickBilingual;

  return snapshot;
}
