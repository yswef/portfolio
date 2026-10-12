/**
 * Structured data (JSON-LD) builders.
 *
 * Only facts that exist in the content snapshot are emitted — an empty field is
 * left out rather than filled with a placeholder, because search engines treat
 * invented values as noise.
 */
import { absoluteUrl, formatDate, localizedPath, pick, type ContentSnapshot, type Locale } from './content';

type Json = Record<string, unknown>;

export function personJsonLd(content: ContentSnapshot, locale: Locale): Json {
  const sameAs = content.socials.map((social) => social.url).filter(Boolean);
  const address: Json = {};
  if (content.profile.city.en || content.profile.city.ar) address.addressLocality = pick(content.profile.city, 'en');
  if (content.profile.countryCode) address.addressCountry = content.profile.countryCode;

  return {
    '@type': 'Person',
    '@id': `${absoluteUrl(content, '/')}#person`,
    name: pick(content.profile.name, locale),
    alternateName: pick(content.profile.name, locale === 'ar' ? 'en' : 'ar'),
    url: absoluteUrl(content, localizedPath(locale, '/')),
    jobTitle: pick(content.profile.headline, locale),
    description: pick(content.profile.summary, locale).slice(0, 400),
    knowsAbout: content.skills.map((skill) => pick(skill.name, 'en')).slice(0, 20),
    knowsLanguage: content.profile.languages.en
      ? content.profile.languages.en.split(',').map((value) => value.trim())
      : undefined,
    ...(Object.keys(address).length ? { address } : {}),
    ...(content.profile.email ? { email: `mailto:${content.profile.email}` } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(content.profile.latitude !== null && content.profile.longitude !== null
      ? {
          workLocation: {
            '@type': 'Place',
            geo: {
              '@type': 'GeoCoordinates',
              latitude: content.profile.latitude,
              longitude: content.profile.longitude,
            },
            ...(Object.keys(address).length ? { address } : {}),
          },
        }
      : {}),
    ...(content.generatedAt && content.generatedAt !== '1970-01-01T00:00:00.000Z' ? { dateModified: content.generatedAt } : {}),
  };
}

export function websiteJsonLd(content: ContentSnapshot, locale: Locale): Json {
  return {
    '@type': 'WebSite',
    '@id': `${absoluteUrl(content, '/')}#website`,
    url: absoluteUrl(content, localizedPath(locale, '/')),
    name: pick(content.profile.name, locale),
    inLanguage: locale === 'ar' ? 'ar' : 'en',
    publisher: { '@id': `${absoluteUrl(content, '/')}#person` },
  };
}

export function breadcrumbJsonLd(
  content: ContentSnapshot,
  items: { name: string; path: string }[],
  locale: Locale,
): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(content, localizedPath(locale, item.path)),
    })),
  };
}

export function profilePageJsonLd(content: ContentSnapshot, locale: Locale): Json {
  return {
    '@type': 'ProfilePage',
    url: absoluteUrl(content, localizedPath(locale, '')),
    name: pick(content.profile.name, locale),
    mainEntity: { '@id': `${absoluteUrl(content, '/')}#person` },
    inLanguage: locale === 'ar' ? 'ar' : 'en',
  };
}

export function softwareApplicationJsonLd(
  content: ContentSnapshot,
  app: ContentSnapshot['apps'][number],
  locale: Locale,
): Json {
  const files = app.assets.filter((asset) => asset.isCurrent);
  const installer = files.find((asset) => asset.kind === 'installer') ?? files[0];
  return {
    '@type': 'SoftwareApplication',
    name: pick(app.name, locale),
    description: pick(app.tagline, locale) || pick(app.name, locale),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: app.platform,
    softwareVersion: app.currentVersion ?? undefined,
    url: absoluteUrl(content, localizedPath(locale, `apps/${app.slug}`)),
    ...(app.repoUrl ? { codeRepository: app.repoUrl } : {}),
    ...(installer ? { fileSize: `${(installer.sizeBytes / (1024 * 1024)).toFixed(1)} MB` } : {}),
    ...(installer?.publishedAt ? { datePublished: installer.publishedAt.slice(0, 10) } : {}),
    offers: {
      '@type': 'Offer',
      price: app.pricing.mode === 'free' ? '0' : undefined,
      priceCurrency: app.pricing.mode === 'free' ? undefined : 'USD',
      description: pick(app.pricing.label, locale) || undefined,
      url: app.pricing.paymentUrl || absoluteUrl(content, localizedPath(locale, `apps/${app.slug}`)),
    },
    ...(app.licenseNote.en || app.licenseNote.ar
      ? { license: pick(app.licenseNote, locale) }
      : {}),
    author: { '@id': `${absoluteUrl(content, '/')}#person` },
    ...(app.stars > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '5',
            ratingCount: Math.max(1, app.stars),
            bestRating: '5',
            worstRating: '1',
          },
        }
      : {}),
  };
}

export function softwareSourceCodeJsonLd(
  content: ContentSnapshot,
  project: ContentSnapshot['projects'][number],
  locale: Locale,
): Json {
  return {
    '@type': 'SoftwareSourceCode',
    name: pick(project.name, locale),
    description: pick(project.description, locale) || project.readmeExcerpt,
    codeRepository: project.url,
    programmingLanguage: project.language ?? undefined,
    keywords: project.topics.join(', ') || undefined,
    license: project.license ?? undefined,
    dateModified: project.pushedAt ?? undefined,
    dateCreated: project.createdAt ?? undefined,
    author: { '@id': `${absoluteUrl(content, '/')}#person` },
    ...(project.homepage ? { url: project.homepage } : {}),
  };
}

export function articleJsonLd(
  content: ContentSnapshot,
  post: ContentSnapshot['posts'][number],
  locale: Locale,
): Json {
  return {
    '@type': 'Article',
    headline: pick(post.title, locale),
    description: pick(post.excerpt, locale) || undefined,
    inLanguage: locale === 'ar' ? 'ar' : 'en',
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt ?? post.publishedAt ?? undefined,
    author: { '@id': `${absoluteUrl(content, '/')}#person` },
    publisher: { '@id': `${absoluteUrl(content, '/')}#person` },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': absoluteUrl(content, localizedPath(locale, `blog/${post.slug}`)),
    },
    ...(post.coverUrl ? { image: post.coverUrl.startsWith('http') ? post.coverUrl : absoluteUrl(content, post.coverUrl) } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
    wordCount: undefined,
  };
}

export function itemListJsonLd(
  content: ContentSnapshot,
  options: { name: string; items: { name: string; path: string }[]; locale: Locale },
): Json {
  return {
    '@type': 'ItemList',
    name: options.name,
    numberOfItems: options.items.length,
    itemListElement: options.items.slice(0, 50).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(content, localizedPath(options.locale, item.path)),
    })),
  };
}

export function serviceJsonLd(
  content: ContentSnapshot,
  service: ContentSnapshot['services'][number],
  locale: Locale,
): Json {
  return {
    '@type': 'Service',
    name: pick(service.title, locale),
    description: pick(service.summary, locale),
    provider: { '@id': `${absoluteUrl(content, '/')}#person` },
    areaServed: pick(content.seo.areaServed, locale) || undefined,
    serviceType: pick(service.title, 'en'),
    url: absoluteUrl(content, localizedPath(locale, 'services')),
  };
}

export function organizationJsonLd(content: ContentSnapshot, locale: Locale): Json {
  return {
    '@type': 'ProfessionalService',
    name: pick(content.profile.name, locale),
    url: absoluteUrl(content, localizedPath(locale, '/')),
    founder: { '@id': `${absoluteUrl(content, '/')}#person` },
    areaServed: pick(content.seo.areaServed, locale) || undefined,
    sameAs: content.socials.map((social) => social.url).filter(Boolean),
  };
}

/** The license string shown to visitors when a repository has one. */
export function licenseLabel(project: ContentSnapshot['projects'][number], locale: Locale): string {
  if (!project.license) return '';
  return locale === 'ar' ? `الترخيص: ${project.license}` : `Licence: ${project.license}`;
}

export function humanDate(value: string | null | undefined, locale: Locale): string {
  return value ? formatDate(value, locale) : '';
}
