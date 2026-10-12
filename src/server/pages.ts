/**
 * Editable pages: HTML documents uploaded from the control panel and served
 * through a session-guarded function.
 *
 * Private by default — a page is only readable with a signed-in session unless
 * its visibility is switched to `public`. Every response is served inside a
 * sandboxed iframe (`sandbox="allow-scripts"` without `allow-same-origin`) and
 * carries a strict CSP, so an uploaded document can never touch the panel, the
 * cookies or the parent page.
 *
 * Files live in Workers KV (`pages/<slug>/<path>`); the index of what exists sits
 * in D1 so directory listings never need a KV list operation (list requests are
 * capped at 1,000/day on the free plan).
 */
import { sha256Hex } from './crypto';
import { contentTypeFor, pageSlug } from './docs';
import { type Env } from './env';

const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

export interface UploadFile {
  path: string;
  /** Text content or raw bytes; one of the two is required. */
  text?: string;
  bytes?: Uint8Array<ArrayBuffer>;
}

export interface PageInput {
  slug?: string;
  title: string;
  titleAr?: string;
  summary?: string;
  summaryAr?: string;
  visibility?: 'private' | 'public';
  tags?: string[];
  entry?: string;
  source?: 'upload' | 'zip' | 'manual';
}

export interface PageRecord {
  id: number;
  slug: string;
  title: string;
  title_ar: string | null;
  summary: string | null;
  summary_ar: string | null;
  visibility: string;
  kind: string;
  entry: string;
  kv_prefix: string;
  file_count: number;
  total_bytes: number;
  tags: string[] | null;
  visible: number;
  sort_order: number;
  views: number;
}

function prefixFor(slug: string): string {
  return `pages/${slug.toLowerCase()}`;
}

function normalizePath(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

/** Picks a slug that is not used yet. */
export async function availableSlug(env: Env, desired: string, existingId?: number): Promise<string> {
  const base = pageSlug(desired);
  const rows = await env.DB.prepare('SELECT id, slug FROM pages').all<{ id: number; slug: string }>();
  const taken = new Set((rows.results ?? []).filter((row) => row.id !== existingId).map((row) => row.slug));
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

/**
 * Creates a page from an uploaded set of files (a single HTML file, several
 * files with a shared prefix, or the result of unpacking a ZIP in the browser).
 */
export async function createPage(
  env: Env,
  input: PageInput,
  files: UploadFile[],
): Promise<{ page: PageRecord; written: number }> {
  if (!files.length) throw new Error('no-files');
  const clean = files
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .filter((file) => file.path && sizeOf(file) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);
  if (!clean.length) throw new Error('no-usable-files');

  const totalBytes = clean.reduce((sum, file) => sum + sizeOf(file), 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('too-large');

  const hasHtml = clean.some((file) => /\.html?$/i.test(file.path));
  if (!hasHtml) throw new Error('missing-html');

  const slug = await availableSlug(env, input.slug || input.title);
  const prefix = prefixFor(slug);
  const entry = pickEntry(input.entry, clean.map((file) => file.path));
  const kind = clean.filter((file) => /\.html?$/i.test(file.path)).length > 1 ? 'multi' : 'single';

  let written = 0;
  for (const file of clean) {
    const body = file.text !== undefined ? file.text : file.bytes!;
    await env.DOCS.put(`${prefix}/${file.path}`, body, {
      metadata: { contentType: contentTypeFor(file.path), slug, storedAt: Date.now() },
    });
    await env.DB.prepare(
      `INSERT INTO files (scope, owner_key, path, kv_key, content_type, size_bytes, sha256, is_entry, sort_order)
       VALUES ('page', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, owner_key, path) DO UPDATE SET
          kv_key = excluded.kv_key, content_type = excluded.content_type,
          size_bytes = excluded.size_bytes, sha256 = excluded.sha256, updated_at = unixepoch()`,
    )
      .bind(
        slug,
        file.path,
        `${prefix}/${file.path}`,
        contentTypeFor(file.path),
        sizeOf(file),
        await sha256Hex(typeof body === 'string' ? body : body),
        file.path === entry ? 1 : 0,
        written,
      )
      .run();
    written += 1;
  }

  const result = await env.DB.prepare(
    `INSERT INTO pages (slug, title, title_ar, summary, summary_ar, visibility, kind, entry, kv_prefix,
        file_count, total_bytes, tags, source, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())`,
  )
    .bind(
      slug,
      input.title,
      input.titleAr ?? null,
      input.summary ?? null,
      input.summaryAr ?? null,
      input.visibility ?? 'private',
      kind,
      entry,
      prefix,
      clean.length,
      totalBytes,
      JSON.stringify(input.tags ?? []),
      input.source ?? 'upload',
    )
    .run();

  const id = Number(result.meta.last_row_id ?? 0);
  await env.DB.prepare('UPDATE files SET owner_id = ? WHERE scope = ? AND owner_key = ?').bind(id, 'page', slug).run();

  const page = await getPage(env, slug);
  return { page: page!, written };
}

function pickEntry(explicit: string | undefined, paths: string[]): string {
  const candidates = [
    explicit ? normalizePath(explicit) : '',
    'index.html',
    'index.htm',
    ...paths.filter((path) => /(^|\/)index\.html?$/i.test(path)),
    ...paths.filter((path) => /\.html?$/i.test(path)).sort(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (paths.includes(candidate)) return candidate;
  }
  return paths[0] ?? 'index.html';
}

function sizeOf(file: UploadFile): number {
  if (file.text !== undefined) return new TextEncoder().encode(file.text).length;
  return file.bytes?.byteLength ?? 0;
}

export async function getPage(env: Env, slug: string): Promise<PageRecord | null> {
  return env.DB.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first<PageRecord>();
}

/** Replaces the contents of an existing page (used by the upload dialog). */
export async function replacePageFiles(
  env: Env,
  page: PageRecord,
  files: UploadFile[],
): Promise<{ written: number; deleted: number }> {
  const clean = files
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .filter((file) => file.path && sizeOf(file) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);
  if (!clean.length) throw new Error('no-usable-files');

  const prefix = page.kv_prefix || prefixFor(page.slug);
  const existing = await env.DB.prepare('SELECT path, kv_key FROM files WHERE scope = ? AND owner_key = ?')
    .bind('page', page.slug)
    .all<{ path: string; kv_key: string }>();
  const existingPaths = new Set((existing.results ?? []).map((row) => row.path));
  const entry = pickEntry(page.entry, clean.map((file) => file.path));

  let written = 0;
  for (const file of clean) {
    const body = file.text !== undefined ? file.text : file.bytes!;
    await env.DOCS.put(`${prefix}/${file.path}`, body, {
      metadata: { contentType: contentTypeFor(file.path), slug: page.slug, storedAt: Date.now() },
    });
    await env.DB.prepare(
      `INSERT INTO files (scope, owner_id, owner_key, path, kv_key, content_type, size_bytes, sha256, is_entry, sort_order, updated_at)
       VALUES ('page', ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(scope, owner_key, path) DO UPDATE SET
          kv_key = excluded.kv_key, content_type = excluded.content_type,
          size_bytes = excluded.size_bytes, sha256 = excluded.sha256, updated_at = unixepoch()`,
    )
      .bind(
        page.id,
        page.slug,
        file.path,
        `${prefix}/${file.path}`,
        contentTypeFor(file.path),
        sizeOf(file),
        await sha256Hex(typeof body === 'string' ? body : body),
        file.path === entry ? 1 : 0,
        written,
      )
      .run();
    existingPaths.delete(file.path);
    written += 1;
  }

  let deleted = 0;
  for (const path of existingPaths) {
    await env.DOCS.delete(`${prefix}/${path}`);
    await env.DB.prepare('DELETE FROM files WHERE scope = ? AND owner_key = ? AND path = ?')
      .bind('page', page.slug, path)
      .run();
    deleted += 1;
  }

  const totalBytes = clean.reduce((sum, file) => sum + sizeOf(file), 0);
  await env.DB.prepare(
    `UPDATE pages SET entry = ?, kind = ?, file_count = ?, total_bytes = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(
      entry,
      clean.filter((file) => /\.html?$/i.test(file.path)).length > 1 ? 'multi' : 'single',
      clean.length,
      totalBytes,
      page.id,
    )
    .run();

  return { written, deleted };
}

export async function deletePage(env: Env, page: PageRecord): Promise<void> {
  const files = await env.DB.prepare('SELECT kv_key FROM files WHERE scope = ? AND owner_key = ?')
    .bind('page', page.slug)
    .all<{ kv_key: string }>();
  for (const file of files.results ?? []) await env.DOCS.delete(file.kv_key);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM files WHERE scope = ? AND owner_key = ?').bind('page', page.slug),
    env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(page.id),
  ]);
}

export interface ServeOptions {
  /** `true` when a valid control-panel session is present. */
  authenticated: boolean;
  origin: string;
}

/**
 * Serves one file of a page. Returns `null` when the file does not exist and a
 * `401`/`403` response when access is not allowed, so the caller can decide how
 * to present the failure.
 */
export async function servePageFile(
  env: Env,
  page: PageRecord,
  path: string,
  options: ServeOptions,
): Promise<Response | null> {
  if (!options.authenticated && page.visibility !== 'public') {
    return new Response('<!doctype html><title>403</title><p>Access denied.', {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const clean = normalizePath(path) || page.entry;
  const record = await env.DB.prepare(
    'SELECT kv_key, content_type, size_bytes FROM files WHERE scope = ? AND owner_key = ? AND path = ?',
  )
    .bind('page', page.slug, clean)
    .first<{ kv_key: string; content_type: string; size_bytes: number }>();
  if (!record) return null;

  const object = await env.DOCS.get(record.kv_key, 'arrayBuffer');
  if (!object) return null;

  const headers: Record<string, string> = {
    'content-type': record.content_type,
    'cache-control': options.authenticated ? 'no-store' : 'public, max-age=300',
    'content-security-policy': [
      "default-src 'none'",
      "img-src 'self' data: blob:",
      "media-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
      "base-uri 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
  };

  if (/\.html?$/i.test(clean)) {
    // Count the visit and note when the page was opened last.
    await env.DB.prepare('UPDATE pages SET views = views + 1, last_viewed_at = unixepoch() WHERE id = ?')
      .bind(page.id)
      .run()
      .catch(() => undefined);
  }

  return new Response(object, { status: 200, headers });
}

/** File listing for the sidebar/breadcrumb of a multi-page document. */
export async function pageFileList(env: Env, page: PageRecord) {
  const rows = await env.DB.prepare(
    'SELECT path, content_type, size_bytes, is_entry FROM files WHERE scope = ? AND owner_key = ? ORDER BY path ASC',
  )
    .bind('page', page.slug)
    .all<{ path: string; content_type: string; size_bytes: number; is_entry: number }>();
  return rows.results ?? [];
}
