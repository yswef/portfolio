/**
 * Content layer: the pre-rendered site must render from the snapshot, and must
 * keep working (with empty sections, never an invented value) when a field has
 * not been filled in from the control panel yet.
 */
import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  categoryLabel,
  formatDate,
  formatNumber,
  loadContent,
  localizedPath,
  pick,
  publishedPosts,
  visibleApps,
  visibleProjects,
} from '../src/server/content';
import { defaultSnapshot, SNAPSHOT_VERSION } from '../src/server/content-types';

describe('snapshot loading', () => {
  it('loads the committed snapshot', () => {
    const content = loadContent();
    expect(content.profile.name.ar).toBeTruthy();
    expect(content.profile.githubUsername).toBe('yswef');
  });

  it('falls back to empty defaults when a snapshot field is missing', () => {
    const content = defaultSnapshot();
    expect(content.version).toBe(SNAPSHOT_VERSION);
    expect(content.projects).toEqual([]);
    expect(content.profile.email).toBe('');
    expect(visibleProjects(content)).toEqual([]);
    expect(publishedPosts(content)).toEqual([]);
  });
});

describe('locale helpers', () => {
  it('keeps Arabic at the root and prefixes English', () => {
    expect(localizedPath('ar', 'projects')).toBe('/projects/');
    expect(localizedPath('en', 'projects')).toBe('/en/projects/');
    expect(localizedPath('ar', '')).toBe('/');
    expect(localizedPath('en', '')).toBe('/en/');
  });

  it('builds absolute addresses from the configured site url, without doubling slashes', () => {
    const content = loadContent();
    expect(absoluteUrl(content, '/projects/')).toMatch(/^https?:\/\/[^/]+\/projects\/$/);
    expect(absoluteUrl(content, 'og/ar/home.png')).not.toContain('.dev//');
  });

  it('picks the requested language and falls back to the other one', () => {
    const value = { ar: 'عربي', en: 'English' };
    expect(pick(value, 'en')).toBe('English');
    expect(pick({ ar: 'عربي', en: '' }, 'en')).toBe('عربي');
    expect(pick(undefined, 'ar')).toBe('');
  });
});

describe('number and date formatting', () => {
  it('always writes Latin digits so numbers stay readable in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      const value = formatNumber(1234, locale);
      expect(value).toMatch(/^1[,.]?234$/);
      expect(value).not.toMatch(/[\u0660-\u0669]/);
      expect(formatNumber(0, locale)).toBe('0');
    }
  });

  it('formats dates in UTC', () => {
    expect(formatDate('2024-03-01T22:30:00.000Z', 'en')).toContain('2024');
    expect(formatDate('2024-03-01T22:30:00.000Z', 'en')).not.toContain('2023');
  });
});

describe('selectors', () => {
  const content = loadContent();

  it('only shows projects that are visible, active and not forks', () => {
    const projects = visibleProjects(content);
    expect(projects.every((project) => project.visible && project.syncState === 'active' && !project.isFork)).toBe(true);
  });

  it('only shows apps that are visible', () => {
    expect(visibleApps(content).every((app) => app.visible)).toBe(true);
  });

  it('orders posts newest first', () => {
    const dates = publishedPosts(content).map((post) => post.publishedAt ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('labels every known category in both languages', () => {
    for (const category of ['web', 'automation', 'desktop', 'wordpress', 'erpnext', 'other'] as const) {
      expect(categoryLabel(category, 'ar')).toBeTruthy();
      expect(categoryLabel(category, 'en')).toBeTruthy();
    }
  });
});
