/**
 * Markdown rendering for content that arrives from three places: the control
 * panel, README files from GitHub, and release notes.
 *
 * Raw HTML in the source is escaped rather than trusted, and links are filtered
 * to safe protocols, so a compromised or careless repository cannot inject
 * script into the site. The renderer walks marked's token stream directly which
 * keeps the output predictable and free of third-party sanitiser dependencies.
 */
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';

export interface RenderOptions {
  /** Rewrites relative links (README images, sibling documents). */
  resolveUrl?: (href: string, kind: 'link' | 'image') => string | null;
  /** Adds `loading="lazy"` and dimension hints to images (default: true). */
  lazyImages?: boolean;
  /** Prefix for heading anchors. */
  headingPrefix?: string;
  /** Enables GitHub-style `- [ ]` task lists. */
  taskLists?: boolean;
}

const SAFE_PROTOCOLS = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

const marked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

function safeUrl(raw: string | null | undefined, options: RenderOptions, kind: 'link' | 'image'): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!value) return null;
  if (/^(javascript|data|vbscript|file):/i.test(value)) {
    // `data:` is allowed for small inline images only, never for links.
    if (!(kind === 'image' && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,/i.test(value))) return null;
  }
  if (SAFE_PROTOCOLS.test(value)) {
    if (options.resolveUrl && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
      return options.resolveUrl(value, kind) ?? value;
    }
    return value;
  }
  return options.resolveUrl ? options.resolveUrl(value, kind) : null;
}

interface RenderContext {
  options: RenderOptions;
  headingCount: Map<string, number>;
  inOrderedList: number[];
}

function renderInline(tokens: Tokens.Generic[] | undefined, context: RenderContext): string {
  if (!tokens) return '';
  return tokens.map((token) => renderToken(token, context)).join('');
}

function renderToken(token: Tokens.Generic, context: RenderContext): string {
  const options = context.options;
  switch (token.type) {
    case 'escape':
      return escapeHtml(token.text as string);
    case 'html': {
      // Raw HTML is shown as text instead of being interpreted.
      const raw = String(token.text ?? '');
      return `<p class="md-raw">${escapeHtml(raw)}</p>`;
    }
    case 'text': {
      if (token.tokens) return renderInline(token.tokens as Tokens.Generic[], context);
      return escapeHtml(String(token.text ?? ''));
    }
    case 'br':
      return '<br>';
    case 'strong': {
      const inner = renderInline(token.tokens as Tokens.Generic[], context);
      return `<strong>${inner}</strong>`;
    }
    case 'em': {
      const inner = renderInline(token.tokens as Tokens.Generic[], context);
      return `<em>${inner}</em>`;
    }
    case 'del': {
      const inner = renderInline(token.tokens as Tokens.Generic[], context);
      return `<del>${inner}</del>`;
    }
    case 'codespan':
      return `<code>${escapeHtml(String(token.text ?? ''))}</code>`;
    case 'code': {
      const language = String(token.lang ?? '').split(/\s+/)[0] ?? '';
      const safeLanguage = /^[a-z0-9+#-]{1,24}$/i.test(language) ? language : '';
      const code = escapeHtml(String(token.text ?? ''));
      return `<figure class="md-code"${safeLanguage ? ` data-lang="${escapeHtml(safeLanguage)}"` : ''}><pre><code${safeLanguage ? ` class="language-${escapeHtml(safeLanguage)}"` : ''}>${code}</code></pre></figure>`;
    }
    case 'link': {
      const href = safeUrl(String(token.href ?? ''), options, 'link');
      const inner = renderInline(token.tokens as Tokens.Generic[], context);
      if (!href) return inner;
      const title = token.title ? ` title="${escapeHtml(String(token.title))}"` : '';
      const external = /^https?:\/\//i.test(href);
      const rel = external ? ' rel="noopener noreferrer nofollow" target="_blank"' : '';
      return `<a href="${escapeHtml(href)}"${title}${rel}>${inner}</a>`;
    }
    case 'image': {
      const src = safeUrl(String(token.href ?? ''), options, 'image');
      if (!src) return escapeHtml(String(token.text ?? ''));
      const alt = escapeHtml(String(token.text ?? ''));
      const lazy = options.lazyImages === false ? '' : ' loading="lazy" decoding="async"';
      return `<img src="${escapeHtml(src)}" alt="${alt}"${lazy}>`;
    }
    case 'checkbox':
      return `<input type="checkbox" disabled${token.checked ? ' checked' : ''}>`;
    case 'list': {
      const ordered = Boolean(token.ordered);
      const items = (token.items as Tokens.Generic[] | undefined) ?? [];
      if (ordered) context.inOrderedList.push(Number(token.start ?? 1));
      const inner = items.map((item) => renderToken(item, context)).join('');
      if (ordered) context.inOrderedList.pop();
      const start = ordered && token.start && Number(token.start) !== 1 ? ` start="${Number(token.start)}"` : '';
      const cls = options.taskLists === false ? '' : ' class="md-list"';
      return ordered ? `<ol${start}${cls}>${inner}</ol>` : `<ul${cls}>${inner}</ul>`;
    }
    case 'list_item': {
      const inner = renderInline((token.tokens as Tokens.Generic[]) ?? [], context);
      const checkbox = token.task ? `<span class="md-task">${token.checked ? '✓' : '·'}</span> ` : '';
      const cleaned = checkbox ? inner.replace(/<input type="checkbox"[^>]*>/, '') : inner;
      return `<li${token.task ? ' class="md-task-item"' : ''}>${checkbox}${cleaned}</li>`;
    }
    case 'heading': {
      const depth = Math.min(6, Math.max(1, Number(token.depth ?? 2)));
      const inner = renderInline((token.tokens as Tokens.Generic[]) ?? [], context);
      const text = String(token.text ?? '');
      let id = slugify(text) || 'section';
      if (options.headingPrefix) id = `${options.headingPrefix}-${id}`;
      const seen = context.headingCount.get(id) ?? 0;
      context.headingCount.set(id, seen + 1);
      if (seen > 0) id = `${id}-${seen}`;
      return `<h${depth} id="${escapeHtml(id)}" class="md-h">${inner}<a class="md-anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a></h${depth}>`;
    }
    case 'paragraph':
      return `<p>${renderInline((token.tokens as Tokens.Generic[]) ?? [], context)}</p>`;
    case 'blockquote': {
      const inner = renderInline((token.tokens as Tokens.Generic[]) ?? [], context);
      return `<blockquote>${inner}</blockquote>`;
    }
    case 'hr':
      return '<hr>';
    case 'table': {
      const header = (token.header as Tokens.Generic[]) ?? [];
      const rows = (token.rows as Tokens.Generic[][]) ?? [];
      const align = (token.align as (string | null)[]) ?? [];
      const cell = (content: string, index: number, tag: 'th' | 'td') => {
        const direction = align[index] ? ` style="text-align:${align[index]}"` : '';
        return `<${tag}${direction}>${content}</${tag}>`;
      };
      const head = `<tr>${header
        .map((cellToken, index) => cell(renderInline([cellToken], context), index, 'th'))
        .join('')}</tr>`;
      const body = rows
        .map((row) => `<tr>${row.map((cellToken, index) => cell(renderInline([cellToken], context), index, 'td')).join('')}</tr>`)
        .join('');
      return `<div class="md-table-wrap"><table class="md-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    }
    case 'space':
      return '';
    case 'def':
      return '';
    default: {
      if (Array.isArray(token.tokens) && token.tokens.length) {
        return renderInline(token.tokens as Tokens.Generic[], context);
      }
      if (typeof token.text === 'string' && token.text) return escapeHtml(token.text);
      return '';
    }
  }
}

/** Renders markdown to HTML with a conservative allow-list of constructs. */
export function renderMarkdown(input: string | null | undefined, options: RenderOptions = {}): string {
  if (!input) return '';
  const source = input.replace(/\r\n?/g, '\n').slice(0, 400_000);
  const tokens = marked.lexer(source) as Tokens.Generic[];
  const context: RenderContext = { options, headingCount: new Map(), inOrderedList: [] };
  return tokens
    .map((token) => renderToken(token, context))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extracts the first N characters of prose — used for meta descriptions. */
export function plainText(markdown: string | null | undefined, limit = 160): string {
  if (!markdown) return '';
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function readingMinutes(markdown: string | null | undefined): number {
  if (!markdown) return 1;
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Headings for the documentation sidebar of multi-page repositories. */
export function extractHeadings(markdown: string | null | undefined) {
  if (!markdown) return [];
  const tokens = marked.lexer(markdown) as Tokens.Generic[];
  return tokens
    .filter((token) => token.type === 'heading')
    .map((token) => ({
      depth: Number(token.depth ?? 2),
      text: String(token.text ?? ''),
      id: slugify(String(token.text ?? '')),
    }))
    .filter((heading) => heading.depth <= 3);
}

export const markdownExtensions: TokenizerAndRendererExtension[] = [];
