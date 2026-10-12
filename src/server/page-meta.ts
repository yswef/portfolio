/**
 * Per-page metadata for the pre-rendered routes.
 *
 * Each page wrapper asks for its metadata here instead of repeating the logic:
 * title, description, canonical path, Open Graph image and the JSON-LD graph.
 */
import {
  categoryLabel,
  localizedPath,
  pick,
  visibleApps,
  visibleProjects,
  type ContentSnapshot,
  type Locale,
} from './content';
import { articleJsonLd, breadcrumbJsonLd, itemListJsonLd, personJsonLd, softwareApplicationJsonLd, softwareSourceCodeJsonLd, websiteJsonLd, serviceJsonLd, profilePageJsonLd, organizationJsonLd } from './seo';
import { ogImagePath, ROUTE_KIND_LABELS, type RouteKind } from './routes';

export interface PageMeta {
  title: string;
  description: string;
  ogImage: string;
  jsonLd: Record<string, unknown>[];
  ogType: 'website' | 'article' | 'profile';
  robots: string;
  keywords: string[];
}

const SUFFIX: Record<Locale, string> = { ar: 'يوسف الحمزي', en: 'Yousif Alhamzi' };

function truncate(value: string, limit = 158): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function brandTitle(section: string, locale: Locale): string {
  return `${section} · ${SUFFIX[locale]}`;
}

function ogFor(locale: Locale, path: string): string {
  return ogImagePath(locale, path);
}

export function sectionMeta(
  content: ContentSnapshot,
  locale: Locale,
  options: { kind: RouteKind; path: string; title?: string; description?: string; extraJsonLd?: Record<string, unknown>[] },
): PageMeta {
  const label = ROUTE_KIND_LABELS[options.kind][locale];
  const title =
    options.title ??
    (options.path
      ? brandTitle(label, locale)
      : `${pick(content.profile.name, locale)} · ${pick(content.profile.headline, locale)}`);
  const description =
    options.description ??
    pick(content.seo.defaultDescription, locale) ??
    pick(content.profile.summary, locale);

  const jsonLd: Record<string, unknown>[] = [personJsonLd(content, locale), websiteJsonLd(content, locale)];
  if (options.kind === 'home') jsonLd.push(profilePageJsonLd(content, locale));
  if (options.kind === 'services') jsonLd.push(organizationJsonLd(content, locale));
  if (options.path && options.kind !== 'home') {
    jsonLd.push(
      breadcrumbJsonLd(
        content,
        [
          { name: ROUTE_KIND_LABELS.home[locale], path: '' },
          { name: label, path: options.path },
        ],
        locale,
      ),
    );
  }
  if (options.kind === 'projects') {
    jsonLd.push(
      itemListJsonLd(content, {
        locale,
        name: ROUTE_KIND_LABELS.projects[locale],
        items: visibleProjects(content).map((project) => ({ name: pick(project.name, locale), path: `projects/${project.slug}` })),
      }),
    );
  }
  if (options.kind === 'apps') {
    jsonLd.push(
      itemListJsonLd(content, {
        locale,
        name: ROUTE_KIND_LABELS.apps[locale],
        items: visibleApps(content).map((app) => ({ name: pick(app.name, locale), path: `apps/${app.slug}` })),
      }),
    );
  }
  if (options.kind === 'services') {
    for (const service of content.services) jsonLd.push(serviceJsonLd(content, service, locale));
  }
  for (const document of options.extraJsonLd ?? []) jsonLd.push(document);

  return {
    title,
    description: truncate(description),
    ogImage: ogFor(locale, options.path),
    jsonLd,
    ogType: options.kind === 'post' ? 'article' : options.kind === 'home' ? 'profile' : 'website',
    robots: 'index, follow',
    keywords: [],
  };
}

export function projectMeta(
  content: ContentSnapshot,
  locale: Locale,
  project: ContentSnapshot['projects'][number],
): PageMeta {
  const name = pick(project.name, locale);
  const description = pick(project.description, locale) || project.readmeExcerpt || pick(content.seo.defaultDescription, locale);
  return {
    title: `${name} — ${pick(content.profile.name, locale)}`,
    description: truncate(description),
    ogImage: ogFor(locale, `projects/${project.slug}`),
    jsonLd: [
      personJsonLd(content, locale),
      softwareSourceCodeJsonLd(content, project, locale),
      breadcrumbJsonLd(
        content,
        [
          { name: ROUTE_KIND_LABELS.home[locale], path: '' },
          { name: ROUTE_KIND_LABELS.projects[locale], path: 'projects' },
          { name, path: `projects/${project.slug}` },
        ],
        locale,
      ),
    ],
    ogType: 'website',
    robots: 'index, follow',
    keywords: [...project.topics, project.language ?? '', categoryLabel(project.category, locale)].filter(Boolean),
  };
}

export function appMeta(content: ContentSnapshot, locale: Locale, app: ContentSnapshot['apps'][number]): PageMeta {
  const name = pick(app.name, locale);
  return {
    title: `${name} — ${pick(content.profile.name, locale)}`,
    description: truncate(pick(app.tagline, locale) || pick(content.seo.defaultDescription, locale)),
    ogImage: ogFor(locale, `apps/${app.slug}`),
    jsonLd: [
      personJsonLd(content, locale),
      softwareApplicationJsonLd(content, app, locale),
      breadcrumbJsonLd(
        content,
        [
          { name: ROUTE_KIND_LABELS.home[locale], path: '' },
          { name: ROUTE_KIND_LABELS.apps[locale], path: 'apps' },
          { name, path: `apps/${app.slug}` },
        ],
        locale,
      ),
    ],
    ogType: 'website',
    robots: 'index, follow',
    keywords: [app.platform, app.currentVersion ?? '', 'download'].filter(Boolean),
  };
}

export function postMeta(content: ContentSnapshot, locale: Locale, post: ContentSnapshot['posts'][number]): PageMeta {
  const title = pick(post.title, locale);
  return {
    title: `${title} — ${pick(content.profile.name, locale)}`,
    description: truncate(pick(post.excerpt, locale) || title),
    ogImage: post.coverUrl && /^https?:/.test(post.coverUrl) ? post.coverUrl : ogFor(locale, `blog/${post.slug}`),
    jsonLd: [
      personJsonLd(content, locale),
      articleJsonLd(content, post, locale),
      breadcrumbJsonLd(
        content,
        [
          { name: ROUTE_KIND_LABELS.home[locale], path: '' },
          { name: ROUTE_KIND_LABELS.blog[locale], path: 'blog' },
          { name: title, path: `blog/${post.slug}` },
        ],
        locale,
      ),
    ],
    ogType: 'article',
    robots: 'index, follow',
    keywords: post.tags,
  };
}

export function pageMeta(content: ContentSnapshot, locale: Locale, page: ContentSnapshot['pages'][number]): PageMeta {
  const title = pick(page.title, locale);
  return {
    title: `${title} — ${pick(content.profile.name, locale)}`,
    description: truncate(pick(page.summary, locale) || title),
    ogImage: ogFor(locale, `pages/${page.slug}`),
    jsonLd: [
      personJsonLd(content, locale),
      breadcrumbJsonLd(
        content,
        [
          { name: ROUTE_KIND_LABELS.home[locale], path: '' },
          { name: ROUTE_KIND_LABELS.pages[locale], path: 'pages' },
          { name: title, path: `pages/${page.slug}` },
        ],
        locale,
      ),
    ],
    ogType: 'website',
    robots: 'index, follow',
    keywords: page.tags,
  };
}

export function notFoundMeta(content: ContentSnapshot, locale: Locale): PageMeta {
  return {
    title: brandTitle('404', locale),
    description: '',
    ogImage: ogFor(locale, ''),
    jsonLd: [websiteJsonLd(content, locale)],
    ogType: 'website',
    robots: 'noindex, follow',
    keywords: [],
  };
}

export function alternatePath(locale: Locale, path: string): string {
  return localizedPath(locale === 'ar' ? 'en' : 'ar', path);
}
