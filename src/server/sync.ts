/**
 * GitHub synchronisation.
 *
 * One pass does all of the following. Every step is idempotent, so the same
 * code path serves the 15-minute schedule, webhook deliveries and the button in
 * the control panel:
 *
 *   1. pulls every public repository (name, description, topics, stars,
 *      languages, licence, timestamps);
 *   2. pulls the latest release of each repository, its files and GitHub's own
 *      download counters, and maintains one app row per downloadable project;
 *   3. refreshes the README when the repository was pushed to;
 *   4. detects the documentation layout and mirrors changed HTML files into KV;
 *   5. registers a `push` + `release` webhook on repositories that lack one;
 *   6. commits `content/snapshot.json`, which is what makes a new repository or
 *      a new release show up on the pre-rendered site automatically.
 *
 * Free-plan discipline: KV allows 1,000 writes/day, so documentation writes are
 * capped per pass and unfinished repositories are picked up by the next one.
 */
import { slugify } from '../lib/slug';
import { type Env, githubUsername } from './env';
import { classifyAsset, detectCategory } from './classify';
import { deriveDocsPlan, storeDocsPlanFiles, type DocsPlan } from './docs';
import { GitHubClient, type GitHubRelease, type GitHubRepo } from './github';
import { buildSnapshot, snapshotCommitPath } from './snapshot';

/** KV writes allowed per pass; the remainder is deferred to the next run. */
const MAX_KV_WRITES_PER_RUN = 120;
/** Webhook registrations per pass (one API request each). */
const MAX_WEBHOOKS_PER_RUN = 8;
/** Repositories refreshed deeply per pass (README, releases, languages, docs). */
const MAX_DEEP_REFRESH = 60;
const SNAPSHOT_PATH = snapshotCommitPath();

export interface SyncOptions {
  trigger: 'cron' | 'webhook' | 'manual' | 'cli';
  /** Restrict the pass to a single repository (`owner/name`) — used by webhooks. */
  repo?: string;
  dryRun?: boolean;
  username?: string;
}

export interface SyncSummary {
  ok: boolean;
  runId: number;
  durationMs: number;
  reposSeen: number;
  reposCreated: number;
  reposUpdated: number;
  releasesSeen: number;
  assetsSeen: number;
  docsSynced: number;
  appsCreated: number;
  webhooksRegistered: number;
  kvWrites: number;
  snapshotCommit: string | null;
  snapshotChanged: boolean;
  rateLimitRemaining: number | null;
  warnings: string[];
  error?: string;
}

interface ProjectRow {
  id: number;
  github_id: number;
  full_name: string;
  slug: string;
  visible: number;
  featured: number;
  doc_mode: string;
  doc_mode_overridden: number;
  docs_path: string | null;
  docs_entry: string | null;
  docs_synced_at: number | null;
  readme_fetched_at: number | null;
  repo_pushed_at: string | null;
  latest_release_tag: string | null;
  sync_state: string;
  override: unknown;
  sort_order: number;
}

interface AppRow {
  id: number;
  slug: string;
  project_id: number | null;
  repo_full_name: string | null;
  dismissed: number;
  auto_created: number;
}

export interface PortfolioOverride {
  title?: string;
  title_ar?: string;
  summary_ar?: string;
  summary_en?: string;
  category?: string;
  doc_mode?: 'readme' | 'single' | 'multi' | 'none';
  docs_path?: string;
  docs_entry?: string;
  featured?: boolean;
  hidden?: boolean;
  order?: number;
}

function projectSlug(name: string, taken: Set<string>): string {
  const base = slugify(name, 'project');
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Runs one synchronisation pass. Never throws: failures are recorded in
 * `sync_runs` and returned so the caller can surface them.
 */
export async function runSync(env: Env, options: SyncOptions): Promise<SyncSummary> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const username = options.username ?? githubUsername(env);

  const runRow = await env.DB.prepare(
    `INSERT INTO sync_runs (trigger, status, started_at) VALUES (?, 'running', unixepoch())`,
  )
    .bind(options.trigger)
    .run();
  const runId = Number(runRow.meta.last_row_id ?? 0);

  const summary: SyncSummary = {
    ok: false,
    runId,
    durationMs: 0,
    reposSeen: 0,
    reposCreated: 0,
    reposUpdated: 0,
    releasesSeen: 0,
    assetsSeen: 0,
    docsSynced: 0,
    appsCreated: 0,
    webhooksRegistered: 0,
    kvWrites: 0,
    snapshotCommit: null,
    snapshotChanged: false,
    rateLimitRemaining: null,
    warnings,
  };

  if (!env.GITHUB_TOKEN) {
    const message = 'GITHUB_TOKEN is not configured';
    summary.error = message;
    await finishRun(env, runId, 'error', summary, message);
    return summary;
  }

  try {
    const client = new GitHubClient(env);
    const repos = await client.listRepos(username);
    summary.reposSeen = repos.length;

    const existingRows = await env.DB.prepare(
      `SELECT id, github_id, full_name, slug, visible, featured, doc_mode, doc_mode_overridden,
              docs_path, docs_entry, docs_synced_at, readme_fetched_at, repo_pushed_at,
              latest_release_tag, sync_state, override, sort_order FROM projects`,
    ).all<ProjectRow>();
    const existing = new Map<number, ProjectRow>((existingRows.results ?? []).map((row) => [row.github_id, row]));
    const slugRegistry = new Set<string>((existingRows.results ?? []).map((row) => row.slug));
    const seenIds = new Set<number>();

    const appRows = await env.DB.prepare('SELECT id, slug, project_id, repo_full_name, dismissed, auto_created FROM apps')
      .all<AppRow>();
    const appsByProject = new Map<number, AppRow>(
      (appRows.results ?? [])
        .filter((row) => row.project_id !== null)
        .map((row) => [row.project_id as number, row]),
    );
    const appsByRepo = new Map<string, AppRow>(
      (appRows.results ?? [])
        .filter((row) => row.repo_full_name)
        .map((row) => [row.repo_full_name as string, row]),
    );

    let deepRefreshes = 0;
    let kvBudget = MAX_KV_WRITES_PER_RUN;

    for (const repo of repos) {
      seenIds.add(repo.id);
      const current = existing.get(repo.id);
      const focused = options.repo ? repo.full_name.toLowerCase() === options.repo.toLowerCase() : false;
      if (options.repo && !focused) continue;

      const isNew = !current;
      const needsDeep =
        focused ||
        isNew ||
        !current?.readme_fetched_at ||
        (repo.pushed_at && current?.repo_pushed_at !== repo.pushed_at) ||
        current?.sync_state !== 'active';

      if (needsDeep && deepRefreshes >= MAX_DEEP_REFRESH && !focused) {
        warnings.push('deep refresh budget reached; remaining repositories deferred');
        continue;
      }
      if (needsDeep) deepRefreshes += 1;

      const override: PortfolioOverride | null = needsDeep
        ? await loadOverride(client, repo)
        : ((current?.override as PortfolioOverride | null) ?? null);

      const languages = needsDeep ? await client.getLanguages(repo.full_name).catch(() => null) : null;
      const release = needsDeep ? await client.getLatestRelease(repo.full_name).catch(() => null) : null;
      const readme = needsDeep ? await client.getReadme(repo.full_name, repo.default_branch).catch(() => null) : null;
      const docPlan = needsDeep ? await deriveDocsPlan(client, repo, override) : null;

      const docMode = docPlan ? (current?.doc_mode_overridden ? current.doc_mode : docPlan.mode) : null;

      if (options.dryRun) {
        if (isNew) summary.reposCreated += 1;
        else summary.reposUpdated += 1;
        continue;
      }

      const project = buildProjectWrite({
        repo,
        current,
        override,
        languages,
        readme,
        docPlan,
        docMode,
        requestedSlug: projectSlug(repo.name, slugRegistry),
        username,
      });

      const projectId = await upsertProject(env, project, current?.id);
      if (isNew) summary.reposCreated += 1;
      else summary.reposUpdated += 1;

      /* ---------------------------------------------- releases and app rows */
      if (release) {
        summary.releasesSeen += 1;
        const existingApp = appsByProject.get(projectId) ?? appsByRepo.get(repo.full_name) ?? null;
        if (existingApp?.dismissed) {
          // The owner deleted this app on purpose: leave it alone.
        } else {
          const app = await ensureApp(env, {
            projectId,
            repo,
            release,
            override,
            existing: existingApp,
            displayName: project.overrideTitle ?? project.name,
            displayNameAr: project.overrideTitleAr,
          });
          if (!existingApp) summary.appsCreated += 1;
          appsByProject.set(projectId, app);
          appsByRepo.set(repo.full_name, app);
          summary.assetsSeen += await upsertReleaseAssets(env, app.id, projectId, release);
        }
      } else if (needsDeep) {
        await env.DB.prepare(
          'UPDATE projects SET latest_release_tag = NULL, latest_release_name = NULL, latest_release_at = NULL, latest_release_notes = NULL, release_downloads = 0 WHERE id = ?',
        )
          .bind(projectId)
          .run();
      }

      /* ------------------------------------------- documentation mirroring */
      if (docPlan && (docPlan.mode === 'single' || docPlan.mode === 'multi')) {
        if (kvBudget > 0) {
          const stored = await storeDocsPlanFiles(env, client, repo, docPlan, projectId, kvBudget);
          summary.docsSynced += stored.filesWritten;
          summary.kvWrites += stored.filesWritten + stored.filesDeleted;
          kvBudget -= stored.filesWritten + stored.filesDeleted;
          if (stored.deferred) warnings.push(`${repo.full_name}: documentation deferred (KV budget)`);
        } else {
          warnings.push(`${repo.full_name}: documentation deferred (KV budget)`);
        }
      }

      /* ------------------------------------------------ webhook registration */
      if (env.GITHUB_WEBHOOK_SECRET && summary.webhooksRegistered < MAX_WEBHOOKS_PER_RUN) {
        if (await ensureWebhook(env, client, repo)) summary.webhooksRegistered += 1;
      }
    }

    /* Repositories that disappeared are flagged, never deleted silently. */
    if (!options.repo) {
      const missing = [...existing.values()].filter((row) => !seenIds.has(row.github_id) && row.sync_state === 'active');
      if (missing.length) {
        await env.DB.batch(
          missing.map((row) =>
            env.DB.prepare('UPDATE projects SET sync_state = ?, updated_at = unixepoch() WHERE id = ?').bind(
              'missing',
              row.id,
            ),
          ),
        );
        warnings.push(`${missing.length} repositories are no longer reachable`);
      }
    }

    /* Retention: sessions, telemetry and one-off tokens. */
    const { cleanupAuth } = await import('./auth');
    await cleanupAuth(env);

    /* Content snapshot → single commit → Pages rebuilds the static site. */
    if (env.PUBLISH_SNAPSHOT !== '0') {
      const published = await publishSnapshot(env, client, username);
      summary.snapshotCommit = published.commit;
      summary.snapshotChanged = published.changed;
      if (published.error) warnings.push(`snapshot: ${published.error}`);
    }

    summary.rateLimitRemaining = client.rateLimitRemaining;
    summary.durationMs = Date.now() - startedAt;
    summary.ok = true;
    await finishRun(env, runId, 'ok', summary, null);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.durationMs = Date.now() - startedAt;
    summary.error = message;
    await finishRun(env, runId, 'error', summary, message);
    return summary;
  }
}

/* ------------------------------------------------------------ row builders */

interface ProjectWrite {
  githubId: number;
  fullName: string;
  owner: string;
  name: string;
  slug: string;
  description: string | null;
  topics: string[];
  htmlUrl: string;
  homepage: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  primaryLanguage: string | null;
  languages: { name: string; bytes: number; percent: number }[] | null;
  license: string | null;
  isFork: boolean;
  isArchived: boolean;
  isTemplate: boolean;
  repoCreatedAt: string | null;
  repoPushedAt: string | null;
  sizeKb: number;
  defaultBranch: string;
  readmeMarkdown: string | null;
  readmeFetchedAt: number | null;
  hasDocs: boolean | null;
  detectedDocMode: string | null;
  docMode: string | null;
  docsPath: string | null;
  docsEntry: string | null;
  docsFileCount: number | null;
  override: Record<string, unknown> | null;
  overrideTitle: string | null;
  overrideTitleAr: string | null;
  overrideSummaryAr: string | null;
  overrideSummaryEn: string | null;
  overrideCategory: string | null;
  overrideFeatured: boolean | null;
  overrideHidden: boolean | null;
  latestReleaseTag: string | null;
  latestReleaseName: string | null;
  latestReleaseAt: string | null;
  latestReleaseNotes: string | null;
  category: string;
  sortOrder: number;
}

function buildProjectWrite(input: {
  repo: GitHubRepo;
  current?: ProjectRow;
  override: PortfolioOverride | null;
  languages: Record<string, number> | null;
  readme: { markdown: string } | null;
  docPlan: DocsPlan | null;
  docMode: string | null;
  requestedSlug: string;
  username: string;
}): ProjectWrite {
  const { repo, current, override, languages, readme, docPlan, docMode } = input;
  const totalBytes = languages ? Object.values(languages).reduce((sum, value) => sum + value, 0) : 0;
  const languageList = languages
    ? Object.entries(languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, bytes]) => ({
          name,
          bytes,
          percent: totalBytes > 0 ? Math.round((bytes / totalBytes) * 1000) / 10 : 0,
        }))
    : null;

  return {
    githubId: repo.id,
    fullName: repo.full_name,
    owner: repo.owner?.login ?? input.username,
    name: repo.name,
    slug: current?.slug ?? input.requestedSlug,
    description: repo.description ?? null,
    topics: repo.topics ?? [],
    htmlUrl: repo.html_url,
    homepage: repo.homepage ?? null,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    watchers: repo.watchers_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    primaryLanguage: repo.language ?? null,
    languages: languageList,
    license: repo.license?.spdx_id ?? repo.license?.name ?? null,
    isFork: Boolean(repo.fork),
    isArchived: Boolean(repo.archived),
    isTemplate: Boolean(repo.is_template),
    repoCreatedAt: repo.created_at ?? null,
    repoPushedAt: repo.pushed_at ?? null,
    sizeKb: repo.size ?? 0,
    defaultBranch: repo.default_branch ?? 'main',
    readmeMarkdown: readme?.markdown ? readme.markdown.slice(0, 200_000) : null,
    readmeFetchedAt: readme ? Math.floor(Date.now() / 1000) : null,
    hasDocs: docPlan ? docPlan.mode !== 'none' : null,
    detectedDocMode: docPlan?.detectedMode ?? null,
    docMode,
    docsPath: docPlan?.rootPath ?? null,
    docsEntry: docPlan?.entry || null,
    docsFileCount: docPlan ? docPlan.files.length : null,
    override: override ? (override as unknown as Record<string, unknown>) : null,
    overrideTitle: override?.title ?? null,
    overrideTitleAr: override?.title_ar ?? null,
    overrideSummaryAr: override?.summary_ar ?? null,
    overrideSummaryEn: override?.summary_en ?? null,
    overrideCategory: override?.category ?? null,
    overrideFeatured: typeof override?.featured === 'boolean' ? override.featured : null,
    overrideHidden: typeof override?.hidden === 'boolean' ? override.hidden : null,
    latestReleaseTag: null,
    latestReleaseName: null,
    latestReleaseAt: null,
    latestReleaseNotes: null,
    category: override?.category ?? detectCategory(repo),
    sortOrder: override?.order ?? current?.sort_order ?? 0,
  };
}

async function upsertProject(env: Env, row: ProjectWrite, existingId?: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `INSERT INTO projects (
        github_id, full_name, owner, name, slug, description, topics, html_url, homepage,
        stars, forks, watchers, open_issues, primary_language, languages, license,
        is_fork, is_archived, is_template, repo_created_at, repo_pushed_at, size_kb, default_branch,
        readme_markdown, readme_fetched_at, has_docs, detected_doc_mode, doc_mode, docs_path, docs_entry,
        docs_file_count, override, override_title, override_title_ar, override_summary_ar, override_summary_en,
        override_category, override_featured, override_hidden,
        category, sort_order, sync_state, synced_at, created_at, updated_at
     ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, 'active', ?, ?, ?
     )
     ON CONFLICT(github_id) DO UPDATE SET
        full_name = excluded.full_name,
        name = excluded.name,
        description = excluded.description,
        topics = excluded.topics,
        html_url = excluded.html_url,
        homepage = excluded.homepage,
        stars = excluded.stars,
        forks = excluded.forks,
        watchers = excluded.watchers,
        open_issues = excluded.open_issues,
        primary_language = excluded.primary_language,
        languages = COALESCE(excluded.languages, projects.languages),
        license = excluded.license,
        is_fork = excluded.is_fork,
        is_archived = excluded.is_archived,
        is_template = excluded.is_template,
        repo_created_at = excluded.repo_created_at,
        repo_pushed_at = excluded.repo_pushed_at,
        size_kb = excluded.size_kb,
        default_branch = excluded.default_branch,
        readme_markdown = COALESCE(excluded.readme_markdown, projects.readme_markdown),
        readme_fetched_at = COALESCE(excluded.readme_fetched_at, projects.readme_fetched_at),
        has_docs = COALESCE(excluded.has_docs, projects.has_docs),
        detected_doc_mode = COALESCE(excluded.detected_doc_mode, projects.detected_doc_mode),
        docs_path = COALESCE(excluded.docs_path, projects.docs_path),
        docs_entry = excluded.docs_entry,
        docs_file_count = COALESCE(excluded.docs_file_count, projects.docs_file_count),
        override = COALESCE(excluded.override, projects.override),
        override_title = COALESCE(excluded.override_title, projects.override_title),
        override_title_ar = COALESCE(excluded.override_title_ar, projects.override_title_ar),
        override_summary_ar = COALESCE(excluded.override_summary_ar, projects.override_summary_ar),
        override_summary_en = COALESCE(excluded.override_summary_en, projects.override_summary_en),
        override_category = COALESCE(excluded.override_category, projects.override_category),
        override_featured = COALESCE(excluded.override_featured, projects.override_featured),
        override_hidden = COALESCE(excluded.override_hidden, projects.override_hidden),
        category = CASE WHEN projects.category_overridden = 1 THEN projects.category ELSE excluded.category END,
        sync_state = 'active',
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at`,
  )
    .bind(
      row.githubId,
      row.fullName,
      row.owner,
      row.name,
      row.slug,
      row.description,
      JSON.stringify(row.topics),
      row.htmlUrl,
      row.homepage,
      row.stars,
      row.forks,
      row.watchers,
      row.openIssues,
      row.primaryLanguage,
      row.languages ? JSON.stringify(row.languages) : null,
      row.license,
      row.isFork ? 1 : 0,
      row.isArchived ? 1 : 0,
      row.isTemplate ? 1 : 0,
      row.repoCreatedAt,
      row.repoPushedAt,
      row.sizeKb,
      row.defaultBranch,
      row.readmeMarkdown,
      row.readmeFetchedAt,
      row.hasDocs === null ? null : row.hasDocs ? 1 : 0,
      row.detectedDocMode,
      row.docMode,
      row.docsPath,
      row.docsEntry,
      row.docsFileCount,
      row.override ? JSON.stringify(row.override) : null,
      row.overrideTitle,
      row.overrideTitleAr,
      row.overrideSummaryAr,
      row.overrideSummaryEn,
      row.overrideCategory,
      row.overrideFeatured === null ? null : row.overrideFeatured ? 1 : 0,
      row.overrideHidden === null ? null : row.overrideHidden ? 1 : 0,
      row.category,
      row.sortOrder,
      now,
      now,
      now,
    )
    .run();

  const id = existingId ?? Number(result.meta.last_row_id ?? 0);
  await env.DB.prepare(
    `UPDATE projects SET doc_mode = ? WHERE id = ? AND doc_mode_overridden = 0`,
  )
    .bind(row.docMode ?? 'readme', id)
    .run();
  return id;
}

/** Creates the app row that owns a project's release files (once). */
async function ensureApp(
  env: Env,
  input: {
    projectId: number;
    repo: GitHubRepo;
    release: GitHubRelease;
    override: PortfolioOverride | null;
    existing: AppRow | null;
    displayName: string;
    displayNameAr: string | null;
  },
): Promise<AppRow> {
  const { projectId, repo, release, override, existing } = input;
  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await env.DB.prepare(
      `UPDATE apps SET current_version = ?, repo_full_name = ?, stars_cached = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(release.tag_name, repo.full_name, repo.stargazers_count ?? 0, now, existing.id)
      .run();
    return existing;
  }

  const slugRow = await env.DB.prepare('SELECT slug FROM apps').all<{ slug: string }>();
  const taken = new Set((slugRow.results ?? []).map((row) => row.slug));
  const base = slugify(repo.name, 'app');
  let slug = base;
  let counter = 2;
  while (taken.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  const result = await env.DB.prepare(
    `INSERT INTO apps (project_id, slug, name, name_ar, tagline, platform, repo_full_name, current_version,
        pricing_mode, visible, featured, auto_created, stars_cached, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', 1, 0, 1, ?, ?, ?)`,
  )
    .bind(
      projectId,
      slug,
      input.displayName,
      input.displayNameAr,
      repo.description?.slice(0, 200) ?? null,
      /desktop|windows|pyqt|tkinter|pyside/i.test(`${repo.name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`)
        ? 'windows'
        : 'cross-platform',
      repo.full_name,
      release.tag_name,
      repo.stargazers_count ?? 0,
      now,
      now,
    )
    .run();

  return {
    id: Number(result.meta.last_row_id ?? 0),
    slug,
    project_id: projectId,
    repo_full_name: repo.full_name,
    dismissed: 0,
    auto_created: 1,
  };
}

/** Writes the files of a release and keeps the counters in sync. */
async function upsertReleaseAssets(
  env: Env,
  appId: number,
  projectId: number,
  release: GitHubRelease,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const assets = release.assets ?? [];
  const statements = assets.map((asset, index) =>
    env.DB.prepare(
      `INSERT INTO app_assets (
          app_id, project_id, github_asset_id, release_tag, release_name, file_name, kind, content_type,
          size_bytes, download_url, release_notes, release_published_at, is_prerelease, is_current, downloads, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(app_id, release_tag, file_name) DO UPDATE SET
          project_id = excluded.project_id,
          github_asset_id = excluded.github_asset_id,
          content_type = excluded.content_type,
          size_bytes = excluded.size_bytes,
          download_url = excluded.download_url,
          release_notes = excluded.release_notes,
          release_published_at = excluded.release_published_at,
          is_prerelease = excluded.is_prerelease,
          downloads = excluded.downloads,
          updated_at = excluded.updated_at`,
    ).bind(
      appId,
      projectId,
      asset.id,
      release.tag_name,
      release.name ?? release.tag_name,
      asset.name,
      classifyAsset(asset.name, index),
      asset.content_type ?? null,
      asset.size ?? 0,
      asset.browser_download_url,
      release.body?.slice(0, 8_000) ?? null,
      release.published_at ?? release.created_at ?? null,
      release.prerelease ? 1 : 0,
      asset.download_count ?? 0,
      now,
    ),
  );

  if (statements.length) await env.DB.batch(statements);

  // Older releases stay downloadable but stop being the "current" files.
  await env.DB.prepare('UPDATE app_assets SET is_current = 0 WHERE app_id = ? AND release_tag <> ?')
    .bind(appId, release.tag_name)
    .run();

  const totals = await env.DB.prepare(
    'SELECT COALESCE(SUM(downloads), 0) AS total, COUNT(DISTINCT release_tag) AS releases FROM app_assets WHERE app_id = ?',
  )
    .bind(appId)
    .first<{ total: number; releases: number }>();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE apps SET current_version = ?, downloads_count = ?, updated_at = ? WHERE id = ?`,
    ).bind(release.tag_name, totals?.total ?? 0, now, appId),
    env.DB.prepare(
      `UPDATE projects SET latest_release_tag = ?, latest_release_name = ?, latest_release_at = ?,
          latest_release_notes = ?, release_downloads = ?, releases_count = ?
        WHERE id = ?`,
    ).bind(
      release.tag_name,
      release.name ?? release.tag_name,
      release.published_at ?? release.created_at,
      release.body?.slice(0, 20_000) ?? null,
      totals?.total ?? 0,
      totals?.releases ?? 1,
      projectId,
    ),
  ]);

  return assets.length;
}

async function loadOverride(client: GitHubClient, repo: GitHubRepo): Promise<PortfolioOverride | null> {
  for (const path of ['.portfolio.json', '.portfolio/portfolio.json', 'portfolio.json']) {
    try {
      const text = await client.getFileText(repo.full_name, path, repo.default_branch);
      if (text) {
        const parsed = JSON.parse(text) as PortfolioOverride;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // A malformed override must never break the sync; the panel still wins.
    }
  }
  return null;
}

/* ---------------------------------------------------------------- webhooks */

async function ensureWebhook(env: Env, client: GitHubClient, repo: GitHubRepo): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT id, hook_id, active FROM webhooks WHERE repo_full_name = ?')
    .bind(repo.full_name)
    .first<{ id: number; hook_id: number | null; active: number }>();
  if (existing?.active) return false;

  const url = `${(env.SITE_URL ?? '').replace(/\/+$/, '')}/api/webhook/github`;
  if (!url.startsWith('https://')) return false;
  const secret = env.GITHUB_WEBHOOK_SECRET!;

  try {
    let hookId = existing?.hook_id ?? null;
    if (hookId) {
      await client.updateWebhook(repo.full_name, hookId, { url, secret, events: ['push', 'release'] });
    } else {
      const hooks = await client.listWebhooks(repo.full_name);
      const match = hooks.find((hook) => hook.config?.url === url);
      hookId = match?.id ?? (await client.createWebhook(repo.full_name, { url, secret, events: ['push', 'release'] }));
    }
    if (!hookId) return false;
    await env.DB.prepare(
      `INSERT INTO webhooks (repo_full_name, hook_id, url, events, active, updated_at)
       VALUES (?, ?, ?, ?, 1, unixepoch())
       ON CONFLICT(repo_full_name) DO UPDATE SET hook_id = excluded.hook_id, url = excluded.url, active = 1, updated_at = unixepoch()`,
    )
      .bind(repo.full_name, hookId, url, JSON.stringify(['push', 'release']))
      .run();
    return true;
  } catch (error) {
    await env.DB.prepare(
      `INSERT INTO webhooks (repo_full_name, url, active, last_error, updated_at)
       VALUES (?, ?, 0, ?, unixepoch())
       ON CONFLICT(repo_full_name) DO UPDATE SET active = 0, last_error = excluded.last_error, updated_at = unixepoch()`,
    )
      .bind(repo.full_name, url, error instanceof Error ? error.message.slice(0, 300) : 'failed')
      .run()
      .catch(() => undefined);
    return false;
  }
}

/* ---------------------------------------------------------------- snapshot */

export async function publishSnapshot(
  env: Env,
  client: GitHubClient,
  username: string,
): Promise<{ commit: string | null; changed: boolean; error?: string }> {
  const repoFullName = env.SNAPSHOT_REPO || `${username}/portfolio`;
  try {
    const snapshot = await buildSnapshot(env, { username });
    const { sha, changed } = await client.upsertFile({
      fullName: repoFullName,
      branch: 'main',
      path: SNAPSHOT_PATH,
      content: `${JSON.stringify(snapshot, null, 2)}\n`,
      message: 'content: refresh published site data',
    });
    return { commit: changed ? sha : null, changed };
  } catch (error) {
    return {
      commit: null,
      changed: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'snapshot failed',
    };
  }
}

async function finishRun(
  env: Env,
  runId: number,
  status: 'ok' | 'error',
  summary: SyncSummary,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sync_runs SET status = ?, finished_at = unixepoch(), duration_ms = ?, repos_seen = ?,
        repos_created = ?, repos_updated = ?, releases_seen = ?, assets_seen = ?, docs_synced = ?,
        webhooks_registered = ?, kv_writes = ?, snapshot_commit = ?, error = ?, details = ?
      WHERE id = ?`,
  )
    .bind(
      status,
      summary.durationMs,
      summary.reposSeen,
      summary.reposCreated,
      summary.reposUpdated,
      summary.releasesSeen,
      summary.assetsSeen,
      summary.docsSynced,
      summary.webhooksRegistered,
      summary.kvWrites,
      summary.snapshotCommit,
      error,
      JSON.stringify({ warnings: summary.warnings, snapshotChanged: summary.snapshotChanged, appsCreated: summary.appsCreated }),
      runId,
    )
    .run();
}

/** Sync history for the control panel. */
export async function recentSyncRuns(env: Env, limit = 20) {
  const rows = await env.DB.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
    .bind(Math.min(100, limit))
    .all();
  return rows.results ?? [];
}
