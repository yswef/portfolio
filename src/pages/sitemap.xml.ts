/**
 * Sitemap with both language versions of every public page.
 *
 * Generated at build time from the same route table the site itself uses, so a
 * new project or article appears here without extra work. Each entry lists the
 * Arabic and English addresses plus `x-default`.
 */
import type { APIRoute } from 'astro';
import { absoluteUrl, localizedPath, loadContent } from '../server/content';
import { listRoutes } from '../server/routes';

export const GET: APIRoute = () => {
  const content = loadContent();
  const routes = listRoutes(content);
  const base = absoluteUrl(content, '/');

  const urls = routes
    .flatMap((entry) => {
      const lastmod = (entry.lastmod ?? content.generatedAt ?? '').slice(0, 10);
      return (['ar', 'en'] as const).map((locale) => {
        const path = localizedPath(locale, entry.path);
        const loc = `${base}${path.replace(/^\//, '')}`;
        const alternates = [
          `<xhtml:link rel="alternate" hreflang="ar" href="${absoluteUrl(content, localizedPath('ar', entry.path))}"/>`,
          `<xhtml:link rel="alternate" hreflang="en" href="${absoluteUrl(content, localizedPath('en', entry.path))}"/>`,
          `<xhtml:link rel="alternate" hreflang="x-default" href="${absoluteUrl(content, localizedPath('ar', entry.path))}"/>`,
        ].join('');
        return `  <url>\n    <loc>${loc}</loc>\n    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>${entry.kind === 'home' ? 'weekly' : 'monthly'}</changefreq>\n    <priority>${entry.priority.toFixed(1)}</priority>\n    ${alternates}\n  </url>`;
      });
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
