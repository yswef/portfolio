/**
 * Sync, downloads and uploads: the parts that touch GitHub or visitors' files.
 */
import { describe, expect, it } from 'vitest';
import { hmac, bytesToHex } from '../src/server/crypto';
import { verifyWebhookSignature } from '../src/server/github';
import { isAllowedDownloadUrl } from '../src/server/downloads';
import { classifyAsset, humanFileSize } from '../src/server/classify';
import { sanitizeEntryPath, ZIP_LIMITS } from '../src/server/zip';
import { contentTypeFor, pageSlug } from '../src/server/docs';
import { detectCategory } from '../src/server/classify';
import { buildDownloadLink, formatFileSize } from '../src/lib/download-link';

describe('download targets', () => {
  it('allows release assets served by GitHub over https', () => {
    expect(isAllowedDownloadUrl('https://github.com/yswef/tool/releases/download/v1/tool.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/x')).toBe(true);
  });

  it('refuses plain http, look-alike hosts and other sites (no open redirect)', () => {
    expect(isAllowedDownloadUrl('http://github.com/yswef/tool/releases/download/v1/tool.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://github.com.evil.example/tool.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://evil.example/github.com/tool.exe')).toBe(false);
    expect(isAllowedDownloadUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedDownloadUrl('not a url')).toBe(false);
  });

  it('builds a local download route for an app and asset', () => {
    const link = buildDownloadLink('my-app', 42);
    expect(link.startsWith('/dl/')).toBe(true);
    expect(link).toContain('my-app');
  });

  it('formats sizes for humans', () => {
    expect(formatFileSize(0)).toBeTruthy();
    expect(formatFileSize(5 * 1024 * 1024)).toMatch(/5/);
  });
});

describe('webhook signatures', () => {
  it('accepts a body signed with the shared secret', async () => {
    const body = JSON.stringify({ action: 'published' });
    const signature = `sha256=${bytesToHex(await hmac('whsec-test', body, 'SHA-256'))}`;
    expect(await verifyWebhookSignature('whsec-test', body, signature)).toBe(true);
  });

  it('rejects a changed body, a wrong secret and a missing header', async () => {
    const body = '{"a":1}';
    const signature = `sha256=${bytesToHex(await hmac('whsec-test', body, 'SHA-256'))}`;
    expect(await verifyWebhookSignature('whsec-test', '{"a":2}', signature)).toBe(false);
    expect(await verifyWebhookSignature('other-secret', body, signature)).toBe(false);
    expect(await verifyWebhookSignature('whsec-test', body, null)).toBe(false);
  });
});

describe('repository categories', () => {
  it('places repositories in the section their content belongs to', () => {
    expect(detectCategory({ name: 'erp-tools', description: 'ERPNext custom app' })).toBe('erpnext');
    expect(detectCategory({ name: 'wp-helper', topics: ['wordpress'] })).toBe('wordpress');
    expect(detectCategory({ name: 'invoice-gui', language: 'Python', description: 'PyQt desktop tool' })).toBe('desktop');
    expect(detectCategory({ name: 'misc-notes' })).toBe('other');
  });
});

describe('asset classification', () => {
  it('recognises installers and checksums', () => {
    expect(classifyAsset('MyTool-Setup-1.2.0.exe')).toBe('installer');
    expect(classifyAsset('SHA256SUMS.txt')).toBe('checksum');
  });

  it('formats byte counts', () => {
    expect(humanFileSize(1536)).toMatch(/KB|1\.5/);
  });
});

describe('uploaded archives and pages', () => {
  it('removes traversal and empty segments from archive paths', () => {
    expect(sanitizeEntryPath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeEntryPath('site/./css//main.css')).toBe('site/css/main.css');
  });

  it('caps archives at 500 entries and 40 MB', () => {
    expect(ZIP_LIMITS.maxEntries).toBe(500);
    expect(ZIP_LIMITS.maxTotalBytes).toBe(40 * 1024 * 1024);
  });

  it('serves known document types and slugs cleanly', () => {
    expect(contentTypeFor('index.html')).toContain('text/html');
    expect(pageSlug('My Study Notes!')).toMatch(/^[a-z0-9-]+$/);
  });
});
