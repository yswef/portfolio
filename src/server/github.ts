/**
 * Thin GitHub REST client with the three capabilities the sync needs:
 * read public repositories and releases, read files (README, docs, overrides),
 * register webhooks and commit the content snapshot.
 *
 * A single fine-grained personal access token is supplied through
 * `GITHUB_TOKEN`. Required permissions (see the deployment guide):
 *   - Metadata: read
 *   - Contents: read (all repositories) and write (the portfolio repository only)
 *   - Webhooks: read and write
 * Nothing is ever written to the database or the logs on failure beyond the
 * status text GitHub returns.
 */
import { bytesToHex, hmac, timingSafeEqual } from './crypto';
import { type Env } from './env';

const API = 'https://api.github.com';
const USER_AGENT = 'yswef-portfolio-sync';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  topics?: string[];
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id?: string; name?: string } | null;
  fork: boolean;
  archived: boolean;
  is_template: boolean;
  size: number;
  default_branch: string;
  created_at: string;
  pushed_at: string;
  updated_at: string;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  download_count: number;
  browser_download_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
  assets: GitHubReleaseAsset[];
  tarball_url: string | null;
  zipball_url: string | null;
}

export interface GitHubContentItem {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  size: number;
  sha: string;
  download_url: string | null;
  content?: string;
  encoding?: string;
  url: string;
}

export interface GitHubRequestOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  /** Treat 404 as `null` instead of throwing. */
  optional?: boolean;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubClient {
  private readonly token: string | undefined;
  private remaining: number | null = null;

  constructor(env: Env, token?: string) {
    this.token = token ?? env.GITHUB_TOKEN;
    if (!this.token) throw new Error('GITHUB_TOKEN is not configured');
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  get rateLimitRemaining(): number | null {
    return this.remaining;
  }

  private headers(accept?: string): HeadersInit {
    const headers: Record<string, string> = {
      accept: accept ?? 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  async request<T>(path: string, options: GitHubRequestOptions = {}): Promise<T | null> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: this.headers(options.accept),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining !== null) this.remaining = Number.parseInt(remaining, 10);

    if (response.status === 404 && options.optional) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GitHubError(`GitHub ${response.status} for ${path}`, response.status, body.slice(0, 500));
    }
    if (response.status === 204) return null as T;
    // `raw` media types answer with the file body, not JSON.
    if ((options.accept ?? '').includes('raw')) return (await response.text()) as unknown as T;
    return (await response.json()) as T;
  }

  /** Every public repository of an account, forks and archives included. */
  async listRepos(username: string): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<GitHubRepo[]>(
        `/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&sort=pushed&type=owner`,
      );
      if (!batch || batch.length === 0) break;
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return repos;
  }

  async listReleases(fullName: string, limit = 30): Promise<GitHubRelease[]> {
    const releases = await this.request<GitHubRelease[]>(
      `/repos/${fullName}/releases?per_page=${Math.min(100, limit)}`,
    );
    return releases ?? [];
  }

  async getLatestRelease(fullName: string): Promise<GitHubRelease | null> {
    return this.request<GitHubRelease>(`/repos/${fullName}/releases/latest`, { optional: true });
  }

  async getLanguages(fullName: string): Promise<Record<string, number>> {
    const languages = await this.request<Record<string, number>>(`/repos/${fullName}/languages`);
    return languages ?? {};
  }

  /** README as markdown. Returns null when the repository has no README. */
  async getReadme(
    fullName: string,
    ref?: string,
  ): Promise<{ markdown: string; path: string } | null> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const markdown = await this.request<string>(`/repos/${fullName}/readme${suffix}`, {
      accept: 'application/vnd.github.raw',
      optional: true,
    });
    if (typeof markdown !== 'string' || !markdown.trim()) return null;
    return { markdown, path: 'README.md' };
  }

  async getFileText(fullName: string, path: string, ref?: string): Promise<string | null> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const response = await this.request<string | GitHubContentItem>(
      `/repos/${fullName}/contents/${encodeURI(path)}${suffix}`,
      { accept: 'application/vnd.github.raw+json', optional: true },
    );
    if (response === null) return null;
    if (typeof response === 'string') return response;
    if (response.content && response.encoding === 'base64') {
      return decodeBase64Utf8(response.content);
    }
    return null;
  }

  async listDirectory(fullName: string, path: string, ref?: string): Promise<GitHubContentItem[]> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const items = await this.request<GitHubContentItem[]>(`/repos/${fullName}/contents/${encodeURI(path)}${suffix}`, {
      optional: true,
    });
    return Array.isArray(items) ? items : [];
  }

  async listTree(fullName: string, ref: string): Promise<{ path: string; size: number; type: string }[]> {
    const tree = await this.request<{ tree: { path: string; size?: number; type: string }[]; truncated: boolean }>(
      `/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { optional: true },
    );
    if (!tree) return [];
    return tree.tree.map((item) => ({ path: item.path, size: item.size ?? 0, type: item.type }));
  }

  /* ------------------------------------------------------------- webhooks */

  async listWebhooks(fullName: string): Promise<{ id: number; config: { url?: string }; active: boolean }[]> {
    const hooks = await this.request<{ id: number; config: { url?: string }; active: boolean }[]>(
      `/repos/${fullName}/hooks`,
      { optional: true },
    );
    return hooks ?? [];
  }

  async createWebhook(
    fullName: string,
    options: { url: string; secret: string; events: string[] },
  ): Promise<number | null> {
    const hook = await this.request<{ id: number }>(`/repos/${fullName}/hooks`, {
      method: 'POST',
      body: {
        name: 'web',
        active: true,
        events: options.events,
        config: { url: options.url, content_type: 'json', secret: options.secret, insecure_ssl: '0' },
      },
    });
    return hook?.id ?? null;
  }

  async updateWebhook(
    fullName: string,
    hookId: number,
    options: { url: string; secret: string; events: string[] },
  ): Promise<void> {
    await this.request(`/repos/${fullName}/hooks/${hookId}`, {
      method: 'PATCH',
      body: {
        active: true,
        events: options.events,
        config: { url: options.url, content_type: 'json', secret: options.secret, insecure_ssl: '0' },
      },
    });
  }

  /* ------------------------------------------------------- snapshot commit */

  async getBranchHead(fullName: string, branch: string): Promise<{ sha: string } | null> {
    const ref = await this.request<{ object?: { sha?: string } }>(
      `/repos/${fullName}/git/ref/heads/${branch}`,
      { optional: true },
    );
    return ref?.object?.sha ? { sha: ref.object.sha } : null;
  }

  /** Creates or updates a single file on a branch (one commit, no force push). */
  async upsertFile(options: {
    fullName: string;
    branch: string;
    path: string;
    content: string;
    message: string;
  }): Promise<{ sha: string; changed: boolean }> {
    const existing = await this.request<GitHubContentItem | null>(
      `/repos/${options.fullName}/contents/${encodeURI(options.path)}?ref=${encodeURIComponent(options.branch)}`,
      { optional: true },
    );
    const encoded = encodeUtf8Base64(options.content);
    if (existing && existing.content) {
      const current = existing.content.replace(/\s+/g, '');
      if (current === encoded.replace(/\s+/g, '')) {
        return { sha: existing.sha, changed: false };
      }
    }
    const result = await this.request<{ content: { sha: string } }>(
      `/repos/${options.fullName}/contents/${encodeURI(options.path)}`,
      {
        method: 'PUT',
        body: {
          message: options.message,
          content: encoded,
          branch: options.branch,
          ...(existing ? { sha: existing.sha } : {}),
        },
      },
    );
    return { sha: result?.content?.sha ?? '', changed: true };
  }
}

/* ------------------------------------------------------------------ helpers */

export function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Verifies the `X-Hub-Signature-256` header of a webhook delivery. */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${bytesToHex(await hmac(secret, body, 'SHA-256'))}`;
  return timingSafeEqual(expected, signatureHeader.trim());
}

/** README links are relative to the repository; make them absolute. */
export function resolveRepoUrl(repoFullName: string, defaultBranch: string, href: string, kind: 'link' | 'image'): string {
  const clean = href.replace(/^\.\//, '');
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith('#')) return clean;
  if (kind === 'image') {
    const raw = clean.replace(/^\.?\/?(?=(images?|assets?|docs?|media)\/)/i, '');
    return `https://raw.githubusercontent.com/${repoFullName}/${defaultBranch}/${raw}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return clean;
  return `https://github.com/${repoFullName}/blob/${defaultBranch}/${clean}`;
}
