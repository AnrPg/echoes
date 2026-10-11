import { escapeMarkdownInline, type MarkdownFlavor } from './markdown/text.ts';
import { escapeHtml } from './html/markdown.ts';

/**
 * Merged exports: several chats in one document, in an order the user chose. Each function takes chats already
 * rendered one by one (by `renderMarkdown`, `renderHtml` or `renderJson`), so a host can reuse the renders of
 * unchanged chats and only supplies the order. The result has a title, a table of contents and one section per
 * chat, with every heading one level deeper so the chats nest under the document's title. Deterministic.
 *
 * @packageDocumentation
 */

/** One chat's rendered document, in the order it should appear. */
export interface MergePart {
  /** The chat's id. */
  id: string;
  /** The chat's title, for the table of contents. */
  title: string;
  /** The chat rendered alone, in the merged document's format. */
  document: string;
}

export interface MergeOptions {
  /** The merged document's title, for example a Project's name. */
  title: string;
}

export interface MarkdownMergeOptions extends MergeOptions {
  /** The flavor the parts were rendered in. Default `github`. Obsidian gets `[[#heading]]` links in the contents. */
  flavor?: MarkdownFlavor;
}

/** The anchor of the `n`th chat (1-based) in a merged document. */
export function mergedChatAnchor(n: number): string {
  return `chat-${n}`;
}

/**
 * Chats rendered as Markdown, in one document: front matter (GitHub and Obsidian), `# Title`, a contents list
 * linking every chat, then each chat with its headings one level deeper (`# Chat` becomes `## Chat`, `## Turn 1`
 * becomes `### Turn 1`). Headings inside code blocks are left alone. A part's own front matter is dropped; render
 * parts with `frontMatter: false` to keep each chat's source and dates as a line under its title.
 *
 * @example
 * ```ts
 * const md = mergeMarkdown(
 *   chats.map((c) => ({ id: c.id, title: c.title, document: renderMarkdown(c, { frontMatter: false }) })),
 *   { title: 'My Project' },
 * );
 * ```
 */
export function mergeMarkdown(parts: readonly MergePart[], options: MarkdownMergeOptions): string {
  const flavor = options.flavor ?? 'github';
  const title = options.title || 'Chats';
  const out: string[] = [];
  if (flavor !== 'commonmark') {
    const q = (s: string) => JSON.stringify(s);
    out.push(['---', `title: ${q(title)}`, `chats: ${parts.length}`, 'conversation_ids:', ...parts.map((p) => `  - ${q(p.id)}`), 'echoes_merged: true', '---'].join('\n'));
  }
  out.push(`# ${escapeMarkdownInline(title)}`);
  out.push(`${parts.length} ${parts.length === 1 ? 'chat' : 'chats'}, in this order:`);
  out.push(
    parts
      .map((p, i) => {
        const name = p.title || 'Untitled chat';
        if (flavor === 'obsidian') return `${i + 1}. [[#${obsidianTarget(firstHeading(p.document) ?? name)}|${name.replace(/[|\]]/g, ' ')}]]`;
        return `${i + 1}. [${escapeMarkdownInline(name)}](#${mergedChatAnchor(i + 1)})`;
      })
      .join('\n'),
  );
  parts.forEach((p, i) => {
    if (flavor !== 'obsidian') out.push(`<a id="${mergedChatAnchor(i + 1)}"></a>`);
    out.push(shiftMarkdownHeadings(stripFrontMatter(p.document)).trim());
  });
  return out.join('\n\n') + '\n';
}

/**
 * Every ATX heading one level deeper (`#` → `##`, up to `######`), except inside fenced code blocks.
 *
 * @example
 * ```ts
 * shiftMarkdownHeadings('# A\n\n```\n# not a heading\n```'); // '## A\n\n```\n# not a heading\n```'
 * ```
 */
export function shiftMarkdownHeadings(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (fence === undefined) fence = f[1]!;
        else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = undefined;
        return line;
      }
      if (fence !== undefined) return line;
      const h = /^(#{1,6})(?=[ \t]|$)/.exec(line);
      if (!h || h[1]!.length === 6) return line;
      return `#${line}`;
    })
    .join('\n');
}

function stripFrontMatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 3);
  return end < 0 ? markdown : markdown.slice(end + 5);
}

function firstHeading(markdown: string): string | undefined {
  const m = /^# (.+)$/m.exec(stripFrontMatter(markdown));
  return m?.[1]?.replace(/\\(.)/g, '$1');
}

/** Obsidian links to a heading by its text; these characters cannot appear in a link target. */
function obsidianTarget(heading: string): string {
  return heading.replace(/[#|^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Chats rendered as HTML pages (by `renderHtml`), in one page: the first part's styles, a header with a contents
 * list, then each chat's content in a `section.chat` with its headings one level deeper. Ids get a per-chat prefix
 * (`turn-1` becomes `c2-turn-1` in the second chat), so links, widgets and anchors inside a chat keep working. The
 * page's Content Security Policy allows the union of every part's script hashes, and each shared script appears once.
 * Images keep the links each part was rendered with.
 *
 * @example
 * ```ts
 * const html = mergeHtml(chats.map((c) => ({ id: c.id, title: c.title, document: renderHtml(c) })), { title: 'My Project' });
 * ```
 */
export function mergeHtml(parts: readonly MergePart[], options: MergeOptions): string {
  if (parts.length === 0) throw new Error('mergeHtml needs at least one chat');
  const pages = parts.map((p) => parseHtmlPage(p.document));
  const first = pages[0]!;
  const title = options.title || 'Chats';
  const hashes = [...new Set(pages.flatMap((p) => p.scriptHashes))];
  const scripts = [...new Set(pages.flatMap((p) => p.scripts))];
  const csp = first.csp.replace(/; script-src [^;]*/, '') + (hashes.length ? `; script-src ${hashes.join(' ')}` : '');
  const toc = parts.map((p, i) => `<li><a href="#${mergedChatAnchor(i + 1)}">${escapeHtml(p.title || 'Untitled chat')}</a></li>`).join('\n');
  const sections = pages.map((p, i) => `<section class="chat" id="${mergedChatAnchor(i + 1)}">\n${shiftHtmlHeadings(prefixIds(p.main, `c${i + 1}-`))}\n</section>`);
  return [
    '<!doctype html>',
    `<html${first.htmlAttrs}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Echoes">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${first.style}\n${MERGED_CSS}\n</style>`,
    '</head>',
    `<body${first.bodyAttrs}>`,
    '<main>',
    `<header>\n<h1>${escapeHtml(title)}</h1>\n<p class="meta"><span>${parts.length} ${parts.length === 1 ? 'chat' : 'chats'}</span></p>\n</header>`,
    `<nav class="toc" aria-label="Contents">\n<h2>Contents</h2>\n<ol>\n${toc}\n</ol>\n</nav>`,
    ...sections,
    '</main>',
    ...scripts.map((s) => `<script>${s}</script>`),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Styles a merged page adds to its theme. */
export const MERGED_CSS = `
nav.toc{margin:0 0 2.5rem;padding:1rem 1.25rem;border:1px solid var(--line);border-radius:12px}
nav.toc h2{margin:0 0 .5rem;font-size:1rem}
nav.toc ol{margin:0;padding-inline-start:1.5rem}
nav.toc li{margin:.2rem 0}
section.chat{margin:0 0 3rem;padding-top:1.5rem;border-top:2px solid var(--line)}
section.chat>header h2{margin-top:0}
section.chat.collapsed>:not(header,.fold-btn){display:none}
`;

interface HtmlPage {
  htmlAttrs: string;
  bodyAttrs: string;
  csp: string;
  scriptHashes: string[];
  style: string;
  main: string;
  scripts: string[];
}

function parseHtmlPage(html: string): HtmlPage {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? "default-src 'none'; style-src 'unsafe-inline'; img-src * data: blob:; font-src data:";
  const head = html.slice(0, html.indexOf('</head>'));
  const mainStart = html.indexOf('<main>');
  const mainEnd = html.lastIndexOf('</main>');
  if (mainStart < 0 || mainEnd < mainStart) throw new Error('mergeHtml: a part is not an Echoes HTML page (no <main>)');
  const tail = html.slice(mainEnd);
  return {
    htmlAttrs: /<html([^>]*)>/.exec(html)?.[1] ?? '',
    bodyAttrs: /<body([^>]*)>/.exec(html)?.[1] ?? '',
    csp,
    scriptHashes: /script-src ([^;]*)/.exec(csp)?.[1]?.trim().split(/\s+/) ?? [],
    style: /<style>\n?([\s\S]*?)\n?<\/style>/.exec(head)?.[1] ?? '',
    main: html.slice(mainStart + '<main>'.length, mainEnd).replace(/^\n|\n$/g, ''),
    scripts: [...tail.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!),
  };
}

/** `<h1>`…`<h5>` one level deeper. Text inside the page is escaped, so every `<h` is a real tag. */
function shiftHtmlHeadings(html: string): string {
  return html.replace(/<(\/?)h([1-6])(?=[\s>])/g, (_m, slash: string, n: string) => `<${slash}h${Math.min(6, Number(n) + 1)}`);
}

/** Prefix every id defined in `html`, and the links and widget style rules that point at them. */
function prefixIds(html: string, prefix: string): string {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!));
  if (ids.size === 0) return html;
  const known = (id: string) => ids.has(id);
  return html
    .replace(/ id="([^"]+)"/g, (_m, id: string) => ` id="${prefix}${id}"`)
    .replace(/ href="#([^"]+)"/g, (m, id: string) => (known(id) ? ` href="#${prefix}${id}"` : m))
    .replace(/<style>([\s\S]*?)<\/style>/g, (_m, css: string) => `<style>${css.replace(/#([A-Za-z][\w-]*)/g, (r, id: string) => (known(id) ? `#${prefix}${id}` : r))}</style>`);
}

/**
 * Chats rendered as Echoes JSON (by `renderJson`), in one bundle: `{ generator, echoes_bundle: 1, title, chats }`,
 * with each chat's JSON unchanged, in order.
 */
export function mergeJson(parts: readonly MergePart[], options: MergeOptions): string {
  const chats = parts.map((p) => JSON.parse(p.document) as unknown);
  return JSON.stringify({ generator: 'echoes', echoes_bundle: 1, title: options.title || 'Chats', chats }, null, 2) + '\n';
}
