/**
 * Structured data must describe only what is actually known: no placeholder
 * values, no empty strings, and the types search engines expect.
 */
import { describe, expect, it } from 'vitest';
import { loadContent, pick } from '../src/server/content';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  personJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
  humanDate,
} from '../src/server/seo';
import type { ContentSnapshot } from '../src/server/content-types';

const content = loadContent();

describe('person and website', () => {
  const person = personJsonLd(content, 'ar');

  it('names the owner and lists the repositories address', () => {
    expect(person['@type']).toBe('Person');
    expect(person.name).toBe(content.profile.name.ar);
    expect(person.sameAs).toContain(`https://github.com/${content.profile.githubUsername}`);
  });

  it('drops fields that have not been filled in', () => {
    const empty: ContentSnapshot = { ...content, profile: { ...content.profile, email: '', city: { ar: '', en: '' }, country: '' } };
    const minimal = personJsonLd(empty, 'en');
    expect(minimal.email).toBeUndefined();
    expect(minimal.address).toBeUndefined();
    expect(Object.values(minimal).every((value) => value !== '' && value !== null)).toBe(true);
  });

  it('describes the website in the requested language', () => {
    const site = websiteJsonLd(content, 'en');
    expect(site['@type']).toBe('WebSite');
    expect(site.inLanguage).toBe('en');
  });
});

describe('breadcrumbs and articles', () => {
  it('numbers breadcrumb items from one', () => {
    const trail = breadcrumbJsonLd(content, [{ name: 'الرئيسية', path: '' }, { name: 'المشاريع', path: 'projects' }], 'ar');
    const items = trail.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0]?.position).toBe(1);
    expect(items[1]?.position).toBe(2);
  });

  it('builds an article from the post itself', () => {
    const post = content.posts[0];
    if (!post) return;
    const article = articleJsonLd(content, post, 'en');
    expect(article['@type']).toBe('Article');
    expect(article.headline).toBe(pick(post.title, 'en'));
    expect(article.author).toMatchObject({ '@type': 'Person' });
  });

  it('formats dates for readers, not machines', () => {
    expect(humanDate('2024-05-06T00:00:00.000Z', 'en')).toContain('2024');
    expect(humanDate('', 'en')).toBe('');
  });
});

describe('software application', () => {
  it('marks a free app with a zero price and a download address', () => {
    const app = content.apps[0];
    if (!app) return;
    const data = softwareApplicationJsonLd(content, app, 'ar');
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.applicationCategory).toBeTruthy();
    const offer = data.offers as Record<string, unknown>;
    expect(offer.price === '0' || offer.price === '0.00' || typeof offer.price === 'string').toBe(true);
  });
});
