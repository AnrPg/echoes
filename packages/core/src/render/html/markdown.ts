import katex from 'katex';
import MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { convertMarkdownText } from '../markdown/text.ts';

/**
 * Markdown text to an HTML fragment, for the HTML renderer. Raw HTML in chat text is shown as text, never run: the
 * exported file opens in a browser, and a chat can contain anything.
 *
 * @packageDocumentation
 */

/**
 * Syntax highlighting hook: the HTML of a whole `<pre>` for `code` in `lang`, or `undefined` for plain text. See
 * `createShikiHighlighter` in `@echoes/core/highlight`.
 */
export type CodeHighlighter = (code: string, lang: string | undefined) => string | undefined;

export interface FragmentOptions {
  highlight?: CodeHighlighter | undefined;
  /** Headings in the text move this many levels deeper (capped at h6), so they sit under the message heading. */
  headingShift?: number;
}

/** Code blocks up to this many lines are kept on one page when printing. */
export const SHORT_CODE_LINES = 15;

const parsers = new Map<CodeHighlighter | undefined, MarkdownIt>();

function parser(highlight: CodeHighlighter | undefined): MarkdownIt {
  let md = parsers.get(highlight);
  if (md) return md;
  md = new MarkdownIt('default', { html: false, linkify: true });
  md.inline.ruler.before('escape', 'echoes_math', mathRule);
  md.renderer.rules['echoes_math'] = (tokens, i) => {
    const t = tokens[i]!;
    return renderMath(t.content, t.meta.display as boolean);
  };
  md.renderer.rules.fence = (tokens, i) => {
    const t = tokens[i]!;
    const lang = t.info.trim().split(/\s+/)[0] || undefined;
    return codeBlock(t.content, lang, highlight);
  };
  md.renderer.rules.code_block = (tokens, i) => codeBlock(tokens[i]!.content, undefined, highlight);
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  const linkOpen = md.renderer.rules.link_open ?? ((tokens, i, opts, _env, self) => self.renderToken(tokens, i, opts));
  md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    tokens[i]!.attrSet('rel', 'noopener noreferrer');
    return linkOpen(tokens, i, opts, env, self);
  };
  parsers.set(highlight, md);
  return md;
}

/**
 * Convert Markdown as the provider writes it (`\( \)` and `\[ \]` math, stray `$`) to HTML. Math becomes MathML
 * through KaTeX, which browsers render natively, so the file needs no math fonts or scripts.
 *
 * @example
 * ```ts
 * markdownToHtml('Area \\(\\pi r^2\\), costs $5.');
 * // '<p>Area <math …>…</math>, costs $5.</p>\n'
 * ```
 */
export function markdownToHtml(text: string, options: FragmentOptions = {}): string {
  return fragmentFromConverted(convertMarkdownText(text, 'commonmark'), options);
}

/** Like {@link markdownToHtml}, for text already in the `commonmark` flavor (math as `$x$` and `$$x$$`). */
export function fragmentFromConverted(markdown: string, options: FragmentOptions = {}): string {
  const md = parser(options.highlight);
  const tokens = md.parse(markdown, {});
  const shift = options.headingShift ?? 0;
  if (shift) {
    for (const t of tokens) {
      if (t.type === 'heading_open' || t.type === 'heading_close') t.tag = `h${Math.min(6, Number(t.tag.slice(1)) + shift)}`;
    }
  }
  return md.renderer.render(tokens, md.options, {});
}

export function codeBlock(code: string, lang: string | undefined, highlight?: CodeHighlighter): string {
  const lines = code.replace(/\n$/, '').split('\n').length;
  const cls = lines <= SHORT_CODE_LINES ? 'code short' : 'code';
  const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
  const pre = highlight?.(code.replace(/\n$/, ''), lang) ?? `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
  return `<div class="${cls}">${label}${pre}</div>\n`;
}

export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, strict: 'ignore', trust: false });
}

/**
 * `$$x$$` (display) and `$x$` (inline) as the `commonmark` flavor writes them. Escaped `\$` never reaches this rule:
 * markdown-it's escape rule runs after it but starts at the backslash. Pandoc's rule decides inline math: the opening
 * `$` is followed by a non-space, the closing one follows a non-space and is not followed by a digit.
 */
function mathRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  let display = false;
  let open = 1;
  if (src.charCodeAt(start + 1) === 0x24) {
    display = true;
    open = 2;
  }
  let end = -1;
  if (display) {
    end = src.indexOf('$$', start + 2);
  } else {
    if (/\s/.test(src[start + 1] ?? ' ')) return false;
    for (let i = start + 1; i < src.length; i++) {
      if (src[i] === '\\') {
        i++;
        continue;
      }
      if (src[i] === '$' && !/\s/.test(src[i - 1]!) && !/[0-9]/.test(src[i + 1] ?? '')) {
        end = i;
        break;
      }
    }
  }
  if (end < 0 || end === start + open) return false;
  if (!silent) {
    const token = state.push('echoes_math', 'math', 0);
    token.content = src.slice(start + open, end);
    token.meta = { display };
  }
  state.pos = end + open;
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
