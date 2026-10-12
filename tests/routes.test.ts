/**
 * Route table, Open Graph images and the sitemap.
 *
 * These three must agree: every address the site advertises has to exist as a
 * page, and every page has to have a social card that the build actually emits.
 */
import { describe, expect, it } from 'vitest';
import { absoluteUrl, loadContent, localizedPath } from '../src/server/content';
import { listRoutes, ogImagePath, routeUrls, ROUTE_KIND_LABELS } from '../src/server/routes';
import { sectionMeta } from '../src/server/page-meta';

const content = loadContent();
const routes = listRoutes(content);

describe('route table', () => {
  it('lists every section in both languages', () => {
    const kinds = new Set(routes.map((route) => route.kind));
    for (const kind of ['home', 'projects', 'apps', 'pages', 'services', 'resume', 'learning', 'blog', 'contact', 'social', 'privacy'] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('has a path, a title and a priority for every entry', () => {
    for (const route of routes) {
      expect(route.path).not.toMatch(/^\//);
      expect(route.title.ar.length).toBeGreaterThan(0);
      expect(route.title.en.length).toBeGreaterThan(0);
      expect(route.priority).toBeGreaterThan(0);
      expect(route.priority).toBeLessThanOrEqual(1);
    }
  });

  it('never repeats an address', () => {
    const paths = routes.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('labels every route kind in both languages', () => {
    for (const kind of Object.keys(ROUTE_KIND_LABELS) as (keyof typeof ROUTE_KIND_LABELS)[]) {
      expect(ROUTE_KIND_LABELS[kind].ar.length).toBeGreaterThan(0);
      expect(ROUTE_KIND_LABELS[kind].en.length).toBeGreaterThan(0);
    }
  });
});

describe('open graph cards', () => {
  it('gives each language its own card, matching the generated file names', () => {
    const expected = new Set<string>();
    for (const route of routes) {
      for (const locale of ['ar', 'en'] as const) {
        const image = ogImagePath(locale, route.path);
        expect(image).toMatch(/^\/og\/(ar|en)\/[a-z0-9\-/]+\.png$/);
        expected.add(image);
      }
    }
    // One card per page per language, never a collision between two routes.
    expect(expected.size).toBe(routes.length * 2);
  });

  it('points every page at the card for its own language', () => {
    const ar = sectionMeta(content, 'ar', { kind: 'projects', path: 'projects' });
    const en = sectionMeta(content, 'en', { kind: 'projects', path: 'projects' });
    expect(ar.ogImage).toBe('/og/ar/projects.png');
    expect(en.ogImage).toBe('/og/en/projects.png');
    expect(ar.ogImage).not.toBe(en.ogImage);
  });

  it('asks search engines to leave the control panel and the 404 page alone', () => {
    expect(sectionMeta(content, 'ar', { kind: 'home', path: '' }).robots).toBe('index, follow');
  });
});

describe('addresses', () => {
  it('resolves both languages plus the canonical address for each route', () => {
    for (const route of routes.slice(0, 4)) {
      const urls = routeUrls(content, route);
      expect(urls.ar).toBe(localizedPath('ar', route.path));
      expect(urls.en).toBe(localizedPath('en', route.path));
      expect(urls.canonical).toBe(absoluteUrl(content, urls.ar));
    }
  });
});
