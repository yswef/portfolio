// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

/**
 * The site is fully pre-rendered: `astro build` emits HTML into `dist/`, which
 * Cloudflare Pages serves from the edge. Everything dynamic (control panel API,
 * GitHub synchronisation, documentation storage, download accounting) lives in
 * `functions/` as Pages Functions, so page views never consume Worker requests.
 *
 * SITE_URL is read at build time so a custom domain can be added later without
 * touching code — change the environment variable in the Pages dashboard and
 * re-deploy.
 */
const site = process.env.SITE_URL || 'https://portfolio.pages.dev';

export default defineConfig({
  site,
  outDir: './dist',
  publicDir: './public',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  trailingSlash: 'ignore',
  compressHTML: true,
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  i18n: {
    defaultLocale: 'ar',
    locales: ['ar', 'en'],
    routing: {
      // Arabic is the primary language and stays at the root (`/`).
      // English lives under `/en/`.
      prefixDefaultLocale: false,
    },
  },
  image: {
    // No server-side image service is used: assets are optimised ahead of time
    // and the free plan has no image transform quota.
    service: { entrypoint: 'astro/assets/services/noop' },
  },
  integrations: [svelte()],
  vite: {
    build: {
      // Three.js is imported lazily in its own chunk; keep the rest lean.
      chunkSizeWarningLimit: 900,
    },
  },
});
