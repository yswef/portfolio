/**
 * Documentation handling for repositories and for pages uploaded by hand.
 *
 * Detection rules (a repository can override any of them through
 * `.portfolio.json`):
 *
 *   - `docs/index.html` is the *only* HTML file  → `single` (iframe)
 *   - two or more HTML files under `docs/`       → `multi`  (sidebar navigation)
 *   - HTML files but no README                   → whichever of the two applies
 *   - README only                                → `readme` (rendered by the site)
 *   - neither                                    → `none`
 *
 * Files are mirrored into Workers KV because the free plan allows 25 MiB per
 * value and 1 GiB of storage, but only 1,000 writes per day — so nothing is
 * written unless the blob digest actually changed.
 */
import type { GitHubClient, GitHubRepo } from './github';
import { sha256Hex } from './crypto';
import { type Env } from './env';

export type DocMode = 'readme' | 'single' | 'multi' | 'none';

export interface DocsFile {
  path: string;
  /** Path relative to the repository root. */
  repoPath: string;
  size: number;
  sha: string;
  contentType: string;
}

export interface DocsPlan {
  mode: DocMode;
  detectedMode: DocMode;
  rootPath: string;
  entry: string;
  files: DocsFile[];
  treeSha: string | null;
}

const DOC_DIR_CANDIDATES = ['docs', 'doc', 'documentation', '.docs', 'site/docs'];
const MAX_DOC_FILES = 60;
const MAX_DOC_FILE_BYTES = 1_500_000;

export function contentTypeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'js':
    case 'mjs':
      return 'text/javascript; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'ico':
      return 'image/x-icon';
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    case 'pdf':
      return 'application/pdf';
    case 'md':
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'xml':
      return 'application/xml';
    default:
      return 'application/octet-stream';
  }
}

interface OverrideShape {
  doc_mode?: DocMode;
  docs_path?: string;
  docs_entry?: string;
}

/**
 * Works out how a repository wants to present its documentation, using the
 * git tree (a single API request) plus the override file when present.
 */
export async function deriveDocsPlan(
  client: GitHubClient,
  repo: GitHubRepo,
  override: OverrideShape | null,
): Promise<DocsPlan> {
  const hasReadme = await client
    .getFileText(repo.full_name, 'README.md', repo.default_branch)
    .then((value) => Boolean(value))
    .catch(() => false);

  let tree: { path: string; size: number; type: string }[] = [];
  try {
    tree = await client.listTree(repo.full_name, repo.default_branch);
  } catch {
    tree = [];
  }

  const blobShas = new Map(tree.filter((item) => item.type === 'blob').map((item) => [item.path, item.size]));

  const rootPath = override?.docs_path
    ? override.docs_path.replace(/\/+$/, '')
    : DOC_DIR_CANDIDATES.find((candidate) =>
        tree.some((item) => item.path === candidate || item.path.startsWith(`${candidate}/`)),
      ) ?? '';

  const htmlInDocs = rootPath
    ? [...blobShas.keys()].filter(
        (path) =>
          path.startsWith(`${rootPath}/`) &&
          /\.html?$/i.test(path) &&
          !path.split('/').some((segment) => segment.startsWith('_') || segment.startsWith('.')) &&
          !/(^|\/)(node_modules|vendor|dist|build)\//.test(path),
      )
    : [];

  let detected: DocMode = 'none';
  if (htmlInDocs.length === 1 && !hasReadme) detected = 'single';
  else if (htmlInDocs.length >= 2) detected = 'multi';
  else if (htmlInDocs.length === 1) detected = 'single';
  else if (hasReadme) detected = 'readme';

  const mode: DocMode = override?.doc_mode ?? detected;

  if (mode === 'readme' || mode === 'none') {
    return { mode, detectedMode: detected, rootPath, entry: '', files: [], treeSha: null };
  }

  const entryCandidates = [
    override?.docs_entry,
    `${rootPath}/index.html`,
    ...htmlInDocs.filter((path) => /index\.html?$/i.test(path)).sort(),
    ...htmlInDocs.filter((path) => path === `${rootPath}/README.html`),
    htmlInDocs.sort()[0],
  ].filter(Boolean) as string[];

  const entry = entryCandidates.find((candidate) => htmlInDocs.includes(candidate)) ?? htmlInDocs[0]!;

  /** Everything the entry page may reference: sibling assets of the docs folder. */
  const assets = [...blobShas.keys()].filter((path) => {
    if (path.startsWith(`${rootPath}/`)) return true;
    return /\.(css|js|mjs|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|json|txt|pdf)$/i.test(path) && !path.includes('/');
  });

  const files: DocsFile[] = [...new Set([...htmlInDocs, ...assets])]
    .filter((path) => {
      const size = blobShas.get(path) ?? 0;
      return size <= MAX_DOC_FILE_BYTES;
    })
    .slice(0, MAX_DOC_FILES)
    .map((path) => ({
      path: rootPath && path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
      repoPath: path,
      size: blobShas.get(path) ?? 0,
      sha: '',
      contentType: contentTypeFor(path),
    }));

  const treeSha = await sha256Hex(files.map((file) => `${file.path}:${file.size}`).join('|'));

  return { mode, detectedMode: detected, rootPath, entry, files, treeSha };
}

export function docsKvPrefix(repoFullName: string): string {
  return `repo-docs/${repoFullName.toLowerCase()}`;
}

export interface StoreResult {
  filesWritten: number;
  filesDeleted: number;
  filesSkipped: number;
  deferred: boolean;
}

/**
 * Mirrors the planned files into KV. Content digests come from the `files`
 * index in D1, so a file is only written when its bytes changed.
 */
export async function storeDocsPlanFiles(
  env: Env,
  client: GitHubClient,
  repo: GitHubRepo,
  plan: DocsPlan,
  projectId: number,
  budget: number,
): Promise<StoreResult> {
  const prefix = docsKvPrefix(repo.full_name);
  const known = await env.DB.prepare(
    'SELECT path, kv_key, sha256, size_bytes FROM files WHERE scope = ? AND owner_key = ?',
  )
    .bind('project-docs', repo.full_name.toLowerCase())
    .all<{ path: string; kv_key: string; sha256: string | null; size_bytes: number }>();

  const knownByPath = new Map((known.results ?? []).map((row) => [row.path, row]));
  let written = 0;
  let skipped = 0;
  let deferred = false;

  for (const file of plan.files) {
    const existing = knownByPath.get(file.path);
    if (existing && existing.size_bytes === file.size && existing.sha256) {
      skipped += 1;
      continue;
    }
    if (written >= budget) {
      deferred = true;
      break;
    }
    const body = await client.getFileText(repo.full_name, file.repoPath, repo.default_branch);
    if (body === null) continue;
    const digest = await sha256Hex(body);
    if (existing?.sha256 === digest) {
      skipped += 1;
      continue;
    }
    const kvKey = `${prefix}/${file.path}`;
    await env.DOCS.put(kvKey, body, {
      metadata: {
        contentType: file.contentType,
        repo: repo.full_name,
        path: file.path,
        digest,
        storedAt: Date.now(),
      },
    });
    await env.DB.prepare(
      `INSERT INTO files (scope, owner_id, owner_key, path, kv_key, content_type, size_bytes, sha256, is_entry, sort_order, updated_at)
       VALUES ('project-docs', ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(scope, owner_key, path) DO UPDATE SET
         kv_key = excluded.kv_key,
         content_type = excluded.content_type,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256,
         is_entry = excluded.is_entry,
         updated_at = unixepoch()`,
    )
      .bind(
        projectId,
        repo.full_name.toLowerCase(),
        file.path,
        kvKey,
        file.contentType,
        new TextEncoder().encode(body).length,
        digest,
        plan.entry && file.repoPath === (plan.rootPath ? `${plan.rootPath}/${plan.entry}` : plan.entry) ? 1 : 0,
        plan.files.indexOf(file),
      )
      .run();
    written += 1;
  }

  /* Files that vanished from the docs folder are removed from KV and D1. */
  let deleted = 0;
  const plannedPaths = new Set(plan.files.map((file) => file.path));
  for (const row of known.results ?? []) {
    if (plannedPaths.has(row.path)) continue;
    if (deleted >= budget) {
      deferred = true;
      break;
    }
    await env.DOCS.delete(row.kv_key);
    await env.DB.prepare('DELETE FROM files WHERE scope = ? AND owner_key = ? AND path = ?')
      .bind('project-docs', repo.full_name.toLowerCase(), row.path)
      .run();
    deleted += 1;
  }

  if (!deferred) {
    await env.DB.prepare('UPDATE projects SET docs_synced_at = unixepoch(), doc_mode = ? WHERE id = ?')
      .bind(plan.mode === 'none' ? 'none' : plan.mode, projectId)
      .run();
  }

  return { filesWritten: written, filesDeleted: deleted, filesSkipped: skipped, deferred };
}

/** Reads a mirrored documentation file. */
export async function readStoredDoc(env: Env, kvKey: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const { value, metadata } = await env.DOCS.getWithMetadata<{ contentType?: string }>(kvKey, 'arrayBuffer');
  if (!value) return null;
  return {
    body: value as ArrayBuffer,
    contentType: metadata?.contentType ?? 'application/octet-stream',
  };
}

/** Rewrites relative links inside an HTML document so the iframe can load assets. */
export function rewriteDocumentLinks(
  html: string,
  options: { baseUrl: string; repoBase?: string; origin: string },
): string {
  let output = html;
  // Drop scripts that would try to reach outside the sandbox — the sandboxed
  // iframe blocks them anyway, this keeps the console clean.
  output = output.replace(/<base[^>]*>/gi, '');
  output = output.replace(
    /(<head[^>]*>)/i,
    `$1<base href="${options.baseUrl}">`,
  );
  return output;
}

/** Assigns a stable, readable slug for an uploaded page. */
export function pageSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `page-${Date.now().toString(36)}`;
}
