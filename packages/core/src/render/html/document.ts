import type { Block, BlockKind, Conversation, Node, Resource } from '../../model/schema.ts';
import { activePath, nodesOf } from '../../model/tree.ts';
import { TURN_PRESETS, applyTurnDefinition, buildTurns, type TurnDefinition } from '../../model/turns.ts';
import { sharedPrefix } from '../../model/versions.ts';
import { groupByLabel, nodesOfTurn, versionNotes, type Group, type VersionNote } from '../layout.ts';
import type { BranchToRender } from '../markdown/document.ts';
import { codeBlock, escapeHtml, markdownToHtml, type CodeHighlighter } from './markdown.ts';
import { themeCss, type HtmlTheme } from './themes.ts';
import { PARENT_RESIZE, scriptHash } from './app.ts';
import { widgetToHtml } from './widget.ts';

/** What a custom HTML block renderer receives besides the block. */
export interface HtmlBlockRenderContext {
  conversation: Conversation;
  node: Node;
  renderDefault(): string;
}

/** Per-kind override returning HTML. Return `undefined` to use the default rendering. */
export type HtmlBlockRenderer<K extends BlockKind = BlockKind> = (block: Extract<Block, { kind: K }>, ctx: HtmlBlockRenderContext) => string | undefined;

/** Options for {@link renderHtml}. Every field is optional. */
export interface HtmlRenderOptions {
  /** Node ids to render, root first. Default: the active path. */
  path?: readonly string[];
  /** Which parts of each turn to include. Default `TURN_PRESETS.fullArchive`. */
  turns?: TurnDefinition;
  /**
   * Only these turns (1-based indexes along the path, as `selectTurns` returns). Turns keep their numbers, so gaps show.
   * Turn 0 (context before the first question) follows the turn definition's `hidden` toggle. Default: every turn.
   */
  selectedTurns?: readonly number[];
  /** Default `article`. */
  theme?: HtmlTheme;
  /** `auto` (default) follows the reader's system setting. Printing is always light. */
  colorScheme?: 'auto' | 'light' | 'dark';
  /** Role headings. Default `User`, `Assistant`, `Context`. */
  labels?: Partial<Record<'user' | 'assistant' | 'system', string>>;
  /** Relative link for a file, as in the Markdown renderer. */
  resolveResource?: (resource: Resource) => string | undefined;
  /** Syntax highlighting; without it code is plain. */
  highlight?: CodeHighlighter;
  blockRenderers?: { [K in BlockKind]?: HtmlBlockRenderer<K> };
  /** Name of the branch this document shows, written under the title. */
  branchName?: string;
}

const DEFAULT_LABELS = { user: 'User', assistant: 'Assistant', system: 'Context' } as const;

/**
 * Render a conversation path as one self-contained HTML file: inline CSS, math as MathML, no scripts, no remote
 * fonts. Widgets stay clickable without scripts (see `widgetToHtml`). The one exception is a widget app (an HTML
 * page with its own scripts): it runs in a sandboxed frame, with only its own scripts allowed, by hash, and no network. Same structure as the Markdown renderer (turns, version notes, reasoning summaries, sources, file
 * placeholders), with a theme. Print it for a PDF. Deterministic.
 *
 * @example
 * ```ts
 * const html = renderHtml(conversation, { theme: 'chatgpt', highlight: await createShikiHighlighter() });
 * ```
 */
export function renderHtml(conversation: Conversation, options: HtmlRenderOptions = {}): string {
  return new HtmlDocument(conversation, options).render();
}

/** Several branches in one HTML file: shared turns once, then a section per branch. See `renderMarkdownBranches`. */
export function renderHtmlBranches(conversation: Conversation, branches: readonly BranchToRender[], options: Omit<HtmlRenderOptions, 'path' | 'branchName'> = {}): string {
  if (branches.length === 0) throw new Error('renderHtmlBranches needs at least one branch');
  if (branches.length === 1) return renderHtml(conversation, { ...options, path: branches[0]!.nodeIds, branchName: branches[0]!.name });
  return new HtmlDocument(conversation, options).renderBranches(branches);
}

class HtmlDocument {
  private readonly c: Conversation;
  private readonly opts: HtmlRenderOptions;
  private readonly labels: Record<'user' | 'assistant' | 'system', string>;
  private notes = new Map<string, VersionNote>();
  private widgets = 0;
  /** Inline scripts of widget apps, allowed by hash in the page's policy. */
  private readonly appScripts: string[] = [];

  constructor(c: Conversation, opts: HtmlRenderOptions) {
    this.c = c;
    this.opts = opts;
    this.labels = { ...DEFAULT_LABELS, ...opts.labels };
  }

  render(): string {
    const body = [this.header(this.opts.branchName)];
    body.push(...this.turns(nodesOf(this.c, this.opts.path ?? activePath(this.c)), () => true, 0));
    return this.page(body);
  }

  renderBranches(branches: readonly BranchToRender[]): string {
    const shared = new Set(sharedPrefix(branches.map((b) => b.nodeIds)));
    const body = [this.header(undefined, branches.length)];
    body.push(...this.turns(nodesOf(this.c, branches[0]!.nodeIds), (id) => shared.has(id), 0));
    branches.forEach((b, i) => {
      const inner = this.turns(nodesOf(this.c, b.nodeIds), (id) => !shared.has(id), 1, shared);
      body.push(`<section class="branch">\n<h2>Branch ${i + 1} of ${branches.length}: ${escapeHtml(b.name)}</h2>\n${inner.join('\n')}\n</section>`);
    });
    return this.page(body);
  }

  private page(body: string[]): string {
    const scheme = this.opts.colorScheme ?? 'auto';
    const theme = this.opts.theme ?? 'article';
    const cls = scheme === 'auto' ? '' : ` class="${scheme}"`;
    return [
      '<!doctype html>',
      `<html${cls}>`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="generator" content="Echoes">',
      // No network, and no scripts except widget apps' own, each allowed by its hash: images in the export folder and
      // links are all the file loads.
      `<meta http-equiv="Content-Security-Policy" content="${this.csp()}">`,
      `<title>${escapeHtml(this.c.title || 'Untitled chat')}</title>`,
      `<style>\n${themeCss(theme)}\n</style>`,
      '</head>',
      `<body class="theme-${theme}">`,
      '<main>',
      ...body,
      '</main>',
      ...(this.appScripts.length ? [`<script>${PARENT_RESIZE}</script>`] : []),
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  /** The page's Content Security Policy. Widget app frames inherit it, so their scripts run only if hashed here. */
  private csp(): string {
    const scripts = this.appScripts.length ? [...new Set([PARENT_RESIZE, ...this.appScripts].map(scriptHash))] : [];
    const script = scripts.length ? `; script-src ${scripts.join(' ')}` : '';
    return `default-src 'none'; style-src 'unsafe-inline'; img-src * data: blob:; font-src data:${script}`;
  }

  private header(branchName: string | undefined, branchCount?: number): string {
    const c = this.c;
    const meta = [`<span>${anchor('Open in ChatGPT', c.sourceUrl)}</span>`];
    meta.push(`<span>Created <time datetime="${escapeHtml(c.createdAt)}">${escapeHtml(c.createdAt.slice(0, 10))}</time></span>`);
    meta.push(`<span>Updated <time datetime="${escapeHtml(c.updatedAt)}">${escapeHtml(c.updatedAt.slice(0, 10))}</time></span>`);
    if (c.model) meta.push(`<span>Model ${escapeHtml(c.model)}</span>`);
    if (branchName) meta.push(`<span>Branch: ${escapeHtml(branchName)}</span>`);
    if (branchCount) meta.push(`<span>${branchCount} branches</span>`);
    return `<header>\n<h1>${escapeHtml(c.title || 'Untitled chat')}</h1>\n<p class="meta">${meta.join('')}</p>\n</header>`;
  }

  private turns(pathNodes: readonly Node[], include: (id: string) => boolean, shift: number, before: ReadonlySet<string> = new Set()): string[] {
    const out: string[] = [];
    const def = this.opts.turns ?? TURN_PRESETS.fullArchive;
    if (include(pathNodes[0]?.id ?? '') && pathNodes[0]?.notFetched === 'earlier-messages') {
      out.push(this.note('Earlier messages in this chat were not loaded, so this export starts partway through.'));
    }
    const picked = this.opts.selectedTurns ? new Set(this.opts.selectedTurns) : undefined;
    const turns = buildTurns(pathNodes)
      .filter((t) => !picked || t.index === 0 || picked.has(t.index))
      .map((t) => applyTurnDefinition(t, def));
    this.notes = versionNotes(this.c, pathNodes, new Set(turns.flatMap(nodesOfTurn).map((n) => n.id).filter(include)));
    for (const turn of turns) {
      const nodes = nodesOfTurn(turn).filter((n) => include(n.id));
      if (!nodes.length) continue;
      const continued = turn.question !== undefined && before.has(turn.question.id) ? ' (continued)' : '';
      const h = `h${2 + shift}`;
      const title = turn.index === 0 ? 'Context' : `Turn ${turn.index}${continued}`;
      const groups = groupByLabel(nodes).map((g) => this.group(g, 3 + shift));
      out.push(`<section class="turn" id="turn-${turn.index}">\n<${h}>${title}</${h}>\n${groups.join('\n')}\n</section>`);
    }
    const leaf = pathNodes.at(-1);
    if (leaf && include(leaf.id) && leaf.notFetched === 'later-messages') out.push(this.note('Later messages under this version were not loaded.'));
    return out;
  }

  private group(group: Group, level: number): string {
    const parts: string[] = [];
    const sources = new Map<string, string | undefined>();
    let reasoning: string[] = [];
    const flush = () => {
      if (reasoning.length) parts.push(this.reasoning(reasoning, level));
      reasoning = [];
    };
    for (const node of group.nodes) {
      const v = this.notes.get(node.id);
      if (v) {
        flush();
        parts.push(`<p class="version">Version ${v.version} of ${v.of} (${v.kind})</p>`);
      }
      for (const block of node.blocks) {
        const custom = this.custom(block, node, level);
        if (custom === undefined && block.kind === 'reasoning') {
          reasoning.push(block.summary);
          continue;
        }
        flush();
        if (custom !== undefined) {
          if (custom !== '') parts.push(custom);
        } else if (block.kind === 'citation') {
          if (!sources.has(block.url)) sources.set(block.url, block.title);
        } else {
          const html = this.block(block, level);
          if (html !== '') parts.push(html);
        }
      }
    }
    flush();
    if (sources.size) {
      const items = [...sources].map(([url, title]) => `<li>${anchor(title ?? url, url)}</li>`);
      parts.push(`<div class="sources"><span class="label">Sources</span>\n<ol>\n${items.join('\n')}\n</ol></div>`);
    }
    const h = `h${Math.min(6, level)}`;
    return `<div class="msg ${group.label}">\n<${h} class="role">${escapeHtml(this.labels[group.label])}</${h}>\n<div class="body" dir="auto">\n${parts.join('\n')}\n</div>\n</div>`;
  }

  private custom(block: Block, node: Node, level: number): string | undefined {
    const fn = this.opts.blockRenderers?.[block.kind] as HtmlBlockRenderer | undefined;
    if (!fn) return undefined;
    return fn(block, {
      conversation: this.c,
      node,
      renderDefault: () => (block.kind === 'reasoning' ? this.reasoning([block.summary], level) : this.block(block, level)),
    });
  }

  private md(text: string, level: number): string {
    return markdownToHtml(text, { highlight: this.opts.highlight, headingShift: level }).trimEnd();
  }

  private block(block: Block, level: number): string {
    switch (block.kind) {
      case 'markdown':
        return this.md(block.text, level);
      case 'code': {
        const code = codeBlock(block.text, block.lang, this.opts.highlight).trimEnd();
        return block.origin === 'tool' ? `<p class="label">Tool call</p>\n${code}` : code;
      }
      case 'toolOutput': {
        const parts = ['<p class="label">Tool output</p>'];
        if (block.text !== '') parts.push(codeBlock(block.text, undefined).trimEnd());
        for (const f of block.files ?? []) parts.push(this.resource(f, 'File'));
        return parts.join('\n');
      }
      case 'image':
        return this.resource(block.resource, block.generated ? 'Generated image' : 'Image', true);
      case 'attachment':
        return this.resource(block.resource, 'Attachment');
      case 'canvas':
        return `<p class="label">Canvas: ${escapeHtml(block.title)}</p>\n${this.md(block.text, level)}`;
      case 'unknown': {
        const raw = JSON.stringify(block.raw ?? null, null, 2);
        return this.note(
          `Echoes could not convert this content (<code>${escapeHtml(block.contentType)}</code>), so its raw data is kept:\n${codeBlock(raw, 'json').trimEnd()}`,
          'Unknown content',
          true,
        );
      }
      case 'reasoning':
        return this.reasoning([block.summary], level);
      case 'citation':
        return `<p>${anchor(block.title ?? block.url, block.url)}</p>`;
      case 'widget':
        return widgetToHtml(block.view, block.source, { id: `widget-${++this.widgets}`, markdown: (text) => this.md(text, level), scripts: this.appScripts });
    }
  }

  private reasoning(summaries: string[], level: number): string {
    return `<details class="reasoning">\n<summary>Reasoning summary</summary>\n${summaries.map((s) => this.md(s, level)).join('\n')}\n</details>`;
  }

  private resource(r: Resource, kind: string, image = false): string {
    const name = r.name ?? r.fileId;
    const href = r.status === 'ok' || r.status === 'pending' ? this.opts.resolveResource?.(r) : undefined;
    if (href !== undefined) {
      if (image) return `<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(r.name ?? kind)}" loading="lazy"></figure>`;
      return `<p>${escapeHtml(kind)}: <a href="${escapeHtml(href)}">${escapeHtml(name)}</a></p>`;
    }
    const why = r.status === 'expired' ? 'expired' : r.status === 'sandbox-gone' ? 'no longer available' : 'not included';
    return `<p class="missing">[${escapeHtml(kind)} ${why}: ${escapeHtml(name)}]</p>`;
  }

  /** A warning box. `body` is HTML when `html` is true, else plain text. */
  private note(body: string, title?: string, html = false): string {
    const t = title ? `<strong>${escapeHtml(title)}</strong>\n` : '';
    return `<aside class="note" role="note">\n${t}${html ? body : `<p>${escapeHtml(body)}</p>`}\n</aside>`;
  }
}

function anchor(text: string, url: string): string {
  const safe = /^(https?:|mailto:)/i.test(url) ? url : '#';
  return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}
