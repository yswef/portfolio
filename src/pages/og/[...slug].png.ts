/**
 * Open Graph images, rendered once at build time.
 *
 * Every public route in both languages gets a real PNG (1200x630) drawn from the
 * same palette as the site, so link previews never look like a default template
 * and no request-time work is needed on the free plan.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { APIRoute, GetStaticPaths } from 'astro';
import { Resvg } from '@resvg/resvg-js';
import { ogSvg } from '../../server/og';
import { loadContent, pick, projectBySlug, type ContentSnapshot, type Locale } from '../../server/content';
import { listRoutes } from '../../server/routes';
import { categoryLabel } from '../../server/content';

const fontsDir = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));

let fontFiles: string[] | null = null;
async function resolveFonts(): Promise<string[]> {
  if (!fontFiles) {
    fontFiles = [
      `${fontsDir}IBMPlexSansArabic-Regular.ttf`,
      `${fontsDir}IBMPlexMono-Medium.ttf`,
    ];
  }
  return fontFiles;
}

async function render(svg: string): Promise<Uint8Array> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      loadSystemFonts: false,
      fontFiles: await resolveFonts(),
      defaultFontFamily: 'IBM Plex Sans Arabic',
    },
    logLevel: 'error',
  });
  return resvg.render().asPng();
}

interface OgRoute {
  kind: string;
  path: string;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  meta?: { eyebrow?: string };
}

/** Strips the site-name suffix and the section prefix so the image stays clean. */
function describe(content: ContentSnapshot, locale: Locale, route: OgRoute) {
  const name = pick(content.profile.name, locale);
  const title = route.title[locale]
    .replace(new RegExp(`\\s*—\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
    .replace(/\s*—\s*(مشروع|تنزيل|project|download)\s*$/i, '');
  const description = route.description[locale].replace(/^[^:]{0,40}:\s*/, '');
  const isHome = route.kind === 'home';
  return {
    title: title || name,
    subtitle: isHome ? pick(content.profile.headline, locale) : description,
    badge: route.meta?.eyebrow ?? `PRTFL // ${route.kind}`,
    footer: isHome ? pick(content.profile.availability, locale) : name,
  };
}

export const getStaticPaths: GetStaticPaths = () => {
  const content = loadContent();
  const routes = listRoutes(content);
  return routes.flatMap((route) =>
    (['ar', 'en'] as const).map((locale) => ({
      params: { slug: `${locale}/${route.path ? route.path.replace(/\/$/, '') : 'home'}` },
      props: { route: { kind: route.kind, path: route.path, title: route.title, description: route.description, meta: route.meta }, locale },
    })),
  );
};

export const GET: APIRoute = async ({ props }) => {
  const { route, locale } = props as { route: OgRoute; locale: Locale };
  const content = loadContent();
  const png = await render(ogSvg({ ...describe(content, locale, route), locale }));
  return new Response(png as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800, immutable',
    },
  });
};
