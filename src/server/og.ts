/**
 * Open Graph image template.
 *
 * Pure string building — no native modules, no file system — so the same layout
 * can be rendered at build time. The renderer lives in the build endpoint.
 */
import type { Locale } from './content';

const PALETTE = {
  bg: '#060807',
  panel: '#0b0f0d',
  line: '#223029',
  brass: '#dfa74c',
  mint: '#43bf9c',
  text: '#e8efe9',
  muted: '#8fa197',
};

const FONT_ARABIC = 'IBM Plex Sans Arabic';
const FONT_MONO = 'IBM Plex Mono';

export interface OgInput {
  /** Main line, usually the page title. */
  title: string;
  /** Second line: short description or the section name. */
  subtitle?: string;
  /** Small technical label in the top strip. */
  badge?: string;
  /** Bottom-left identity line. */
  footer?: string;
  locale: Locale;
}

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Greedy wrap that respects the character budget of the layout font size. */
function wrap(value: string, perLine: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length + 1) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,،…]+$/, '')}…`;
  }
  return lines;
}

/**
 * Builds the image as SVG. The frame uses the same hairline-and-notch language
 * as the site: a charcoal slab, brass corner marks and a mint accent rule.
 */
export function ogSvg(input: OgInput): string {
  const rtl = input.locale === 'ar';
  const font = `'${FONT_ARABIC}', '${FONT_MONO}', sans-serif`;
  const mono = `'${FONT_MONO}', monospace`;
  const align = rtl ? 'end' : 'start';
  const anchorX = rtl ? WIDTH - 72 : 72;
  const lineHeight = 74;

  const titleLines = wrap(input.title, rtl ? 30 : 34, 3);
  const subtitleLines = input.subtitle ? wrap(input.subtitle, rtl ? 58 : 68, 2) : [];
  const titleSize = titleLines.length > 2 ? 66 : 76;

  const titleStart = 300 - ((titleLines.length - 1) * lineHeight) / 2;
  const title = titleLines
    .map(
      (line, index) =>
        `<text x="${anchorX}" y="${titleStart + index * lineHeight}" fill="${PALETTE.text}" font-family="${font}" font-size="${titleSize}" font-weight="600" text-anchor="${align}" direction="${rtl ? 'rtl' : 'ltr'}">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  const subtitleStart = 300 + ((titleLines.length - 1) * lineHeight) / 2 + 76;
  const subtitle = subtitleLines
    .map(
      (line, index) =>
        `<text x="${anchorX}" y="${subtitleStart + index * 38}" fill="${PALETTE.muted}" font-family="${font}" font-size="30" text-anchor="${align}" direction="${rtl ? 'rtl' : 'ltr'}">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  const badge = input.badge ?? '';
  const footer = input.footer ?? '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PALETTE.bg}"/>
  <rect x="28" y="28" width="${WIDTH - 56}" height="${HEIGHT - 56}" fill="${PALETTE.panel}" stroke="${PALETTE.line}" stroke-width="2"/>
  <rect x="28" y="28" width="6" height="86" fill="${PALETTE.brass}"/>
  <rect x="44" y="52" width="120" height="6" fill="${PALETTE.mint}"/>
  <rect x="${WIDTH - 52}" y="52" width="24" height="24" fill="none" stroke="${PALETTE.brass}" stroke-width="2"/>
  <rect x="${WIDTH - 96}" y="52" width="24" height="24" fill="none" stroke="${PALETTE.line}" stroke-width="2"/>
  <rect x="${WIDTH - 140}" y="52" width="24" height="24" fill="none" stroke="${PALETTE.line}" stroke-width="2"/>
  <text x="72" y="132" fill="${PALETTE.brass}" font-family="${mono}" font-size="24" letter-spacing="4">${escapeXml(badge.toUpperCase())}</text>
  ${title}
  ${subtitle}
  <text x="${anchorX}" y="${HEIGHT - 84}" fill="${PALETTE.muted}" font-family="${mono}" font-size="24" text-anchor="${align}" direction="${rtl ? 'rtl' : 'ltr'}">${escapeXml(footer)}</text>
  <text x="${rtl ? 72 : WIDTH - 72}" y="${HEIGHT - 84}" fill="${PALETTE.mint}" font-family="${mono}" font-size="24" text-anchor="${rtl ? 'start' : 'end'}">yswef</text>
</svg>
`;
}

export const OG_SIZE = { width: WIDTH, height: HEIGHT };
