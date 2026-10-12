/**
 * robots.txt — the control panel is kept out of every index, everything else is
 * open. The panel path comes from the build environment so it stays private.
 */
import type { APIRoute } from 'astro';
import { absoluteUrl, loadContent } from '../server/content';

export const GET: APIRoute = () => {
  const content = loadContent();
  const admin = import.meta.env.ADMIN_PATH || 'control-panel';

  const body = [
    'User-agent: *',
    'Allow: /',
    `Disallow: /${admin}/`,
    'Disallow: /api/',
    'Disallow: /d/',
    '',
    '# Crawlers that ignore the analytics exclusion below still get counted as bots server-side.',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl(content, '/sitemap.xml')}`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
