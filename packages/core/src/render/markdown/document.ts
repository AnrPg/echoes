import type { Block, BlockKind, Conversation, Node, Resource, Role } from '../../model/schema.ts';
import { activePath, nodesOf } from '../../model/tree.ts';
import { TURN_PRESETS, applyTurnDefinition, buildTurns, type Turn, type TurnDefinition } from '../../model/turns.ts';
import { convertMarkdownText, escapeMarkdownInline, type MarkdownFlavor } from './text.ts';

/** What a custom block renderer receives besides the block. */
export interface BlockRenderContext {
  conversation: Conversation;
  node: Node;
  flavor: MarkdownFlavor;
  /** The default rendering, so an override can wrap it instead of starting from scratch. */
  renderDefault(): string;
}

/** Per-kind override. Return `undefined` to use the default rendering. */
export type BlockRenderer<K extends BlockKind = BlockKind> = (
  block: Extract<Block, { kind: K }>,
  ctx: BlockRenderContext,
) => string | undefined;

/** Options for {@link renderMarkdown}. Every field is optional. */
export interface MarkdownRenderOptions {
  /** Default `github`. */
  flavor?: MarkdownFlavor;
  /**
   * Node ids to render, root first, as returned by `activePath`, `pathThrough` or `traversals`. Default: the active
   * path. Must be a path; it is not checked here.
   */
  path?: readonly string[];
  /** Which parts of each turn to include. Default `TURN_PRESETS.fullArchive`. */
  turns?: TurnDefinition;
  /** YAML front matter with the chat's metadata. Default true, except for `commonmark` (which has no front matter). */
  frontMatter?: boolean;
  /** Section headings per role. Default `User`, `Assistant`, and `Context` for system nodes. Tool nodes go under the assistant. */
  labels?: Partial<Record<'user' | 'assistant' | 'system', string>>;
  /**
   * Relative link for a file (image, attachment, tool output file), or `undefined` when the file is not part of the
   * export. Default: none, so files show as a visible placeholder. Only called for resources with status `ok` or
   * `pending`; `expired` and `sandbox-gone` files are always placeholders.
   */
  resolveResource?: (resource: Resource) => string | undefined;
  /** Override how individual block kinds are rendered (the renderer plugin point). */
  blockRenderers?: { [K in BlockKind]?: BlockRenderer<K> };
}

const DEFAULT_LABELS = { user: 'User', assistant: 'Assistant', system: 'Context' } as const;

/**
 * Render a conversation path as one Markdown document. Deterministic: the same input and options always give the
 * same bytes (no clock, no randomness, no locale-dependent formatting).
 *
 * Layout: front matter, `# Title`, then one `## Turn N` section per question with `### User` and `### Assistant`
 * subsections. Messages before the first question are `## Context`. Version notes ("Version 2 of 3") appear where
 * the path passes an edited question or a regenerated answer. Gaps the adapter flagged (`notFetched`) are stated.
 * Citations are listed as **Sources** after each answer. `unknown` blocks are shown with their raw JSON.
 *
 * @example
 * ```ts
 * const md = renderMarkdown(conversation, { flavor: 'obsidian', turns: TURN_PRESETS.studyNotes });
 * const other = renderMarkdown(conversation, { path: pathThrough(conversation, versionId) });
 * ```
 */
export function renderMarkdown(conversation: Conversation, options: MarkdownRenderOptions = {}): string {
  const r = new MarkdownDocument(conversation, options);
  return r.render();
}

type Group = { label: 'user' | 'assistant' | 'system'; nodes: Node[] };

class MarkdownDocument {
  private readonly c: Conversation;
  private readonly flavor: MarkdownFlavor;
  private readonly opts: MarkdownRenderOptions;
  private readonly labels: Record<'user' | 'assistant' | 'system', string>;
  /** Version note per rendered node id. */
  private versionNotes = new Map<string, string>();

  constructor(c: Conversation, opts: MarkdownRenderOptions) {
    this.c = c;
    this.opts = opts;
    this.flavor = opts.flavor ?? 'github';
    this.labels = { ...DEFAULT_LABELS, ...opts.labels };
  }

  render(): string {
    const c = this.c;
    const path = this.opts.path ?? activePath(c);
    const def = this.opts.turns ?? TURN_PRESETS.fullArchive;
    const sections: string[] = [];

    const frontMatter = this.opts.frontMatter ?? this.flavor !== 'commonmark';
    if (frontMatter) sections.push(this.frontMatter());
    sections.push(`# ${escapeMarkdownInline(c.title || 'Untitled chat')}`);
    if (!frontMatter) sections.push(this.metadataLine());

    const pathNodes = nodesOf(c, path);
    if (pathNodes[0]?.notFetched === 'earlier-messages') {
      sections.push(this.note('warning', 'Earlier messages in this chat were not loaded, so this export starts partway through.'));
    }

    const turns = buildTurns(pathNodes).map((t) => applyTurnDefinition(t, def));
    this.versionNotes = versionNotes(c, pathNodes, new Set(turns.flatMap(nodesOfTurn).map((n) => n.id)));
    for (const turn of turns) {
      const nodes = nodesOfTurn(turn);
      if (!nodes.length) continue;
      sections.push(turn.index === 0 ? '## Context' : `## Turn ${turn.index}`);
      for (const group of groupByLabel(nodes)) sections.push(this.group(group));
    }

    // Only a leaf can have unloaded later messages, so the note goes last, even if filtering removed the leaf.
    if (pathNodes.at(-1)?.notFetched === 'later-messages') {
      sections.push(this.note('warning', 'Later messages under this version were not loaded.'));
    }
    return sections.join('\n\n') + '\n';
  }

  private frontMatter(): string {
    const c = this.c;
    const q = (s: string) => JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar
    const lines = ['---', `title: ${q(c.title)}`, `conversation_id: ${q(c.id)}`, `source: ${q(c.sourceUrl)}`];
    lines.push(`created: ${q(c.createdAt)}`, `updated: ${q(c.updatedAt)}`);
    if (c.model) lines.push(`model: ${q(c.model)}`);
    if (c.projectId) lines.push(`project: ${q(c.projectId)}`);
    lines.push(`echoes_schema: ${c.schemaVersion}`, '---');
    return lines.join('\n');
  }

  private metadataLine(): string {
    const c = this.c;
    const parts = [`Source: ${link(c.sourceUrl, c.sourceUrl)}`, `Updated: ${c.updatedAt}`];
    if (c.model) parts.push(`Model: ${escapeMarkdownInline(c.model)}`);
    return parts.join(' · ');
  }

  private group(group: Group): string {
    const parts = [`### ${escapeMarkdownInline(this.labels[group.label])}`];
    const sources = new Map<string, string | undefined>();
    // Consecutive reasoning blocks share one container, also across nodes (thoughts, then "Worked for 16s").
    let reasoning: string[] = [];
    const flushReasoning = () => {
      if (reasoning.length) parts.push(this.reasoning(reasoning));
      reasoning = [];
    };
    for (const node of group.nodes) {
      const version = this.versionNotes.get(node.id);
      if (version) {
        flushReasoning();
        parts.push(version);
      }
      for (const block of node.blocks) {
        const custom = this.custom(block, node);
        if (custom === undefined && block.kind === 'reasoning') {
          reasoning.push(block.summary);
          continue;
        }
        flushReasoning();
        if (custom !== undefined) {
          if (custom !== '') parts.push(custom);
        } else if (block.kind === 'citation') {
          if (!sources.has(block.url)) sources.set(block.url, block.title);
        } else {
          const text = this.block(block);
          if (text !== '') parts.push(text);
        }
      }
    }
    flushReasoning();
    if (sources.size) {
      const items = [...sources].map(([url, title], i) => `${i + 1}. ${link(title ?? url, url)}`);
      parts.push(`**Sources**\n\n${items.join('\n')}`);
    }
    return parts.join('\n\n');
  }

  private custom(block: Block, node: Node): string | undefined {
    const fn = this.opts.blockRenderers?.[block.kind] as BlockRenderer | undefined;
    if (!fn) return undefined;
    return fn(block, {
      conversation: this.c,
      node,
      flavor: this.flavor,
      renderDefault: () => (block.kind === 'reasoning' ? this.reasoning([block.summary]) : this.block(block)),
    });
  }

  /** Default rendering of every block kind except reasoning (grouped) and citation (collected). */
  private block(block: Block): string {
    switch (block.kind) {
      case 'markdown':
        return trimEnd(convertMarkdownText(block.text, this.flavor));
      case 'code':
        return block.origin === 'tool'
          ? `**Tool call**\n\n${fence(block.text, block.lang)}`
          : fence(block.text, block.lang);
      case 'toolOutput': {
        const parts = ['**Tool output**'];
        if (block.text !== '') parts.push(fence(block.text));
        for (const f of block.files ?? []) parts.push(this.resource(f, 'File'));
        return parts.join('\n\n');
      }
      case 'image':
        return this.resource(block.resource, block.generated ? 'Generated image' : 'Image', true);
      case 'attachment':
        return this.resource(block.resource, 'Attachment');
      case 'canvas':
        return `**Canvas: ${escapeMarkdownInline(block.title)}**\n\n${trimEnd(convertMarkdownText(block.text, this.flavor))}`;
      case 'unknown': {
        const raw = JSON.stringify(block.raw ?? null, null, 2);
        const body = `Echoes could not convert this content (\`${block.contentType.replace(/`/g, "'")}\`), so its raw data is kept:\n\n${fence(raw, 'json')}`;
        return this.note('warning', body, 'Unknown content');
      }
      case 'reasoning':
        return this.reasoning([block.summary]);
      case 'citation':
        return link(block.title ?? block.url, block.url);
    }
  }

  private reasoning(summaries: string[]): string {
    const body = summaries.map((s) => trimEnd(convertMarkdownText(s, this.flavor))).join('\n\n');
    const title = 'Reasoning summary';
    switch (this.flavor) {
      case 'github':
        return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
      case 'obsidian':
        return quote(`[!abstract]- ${title}\n${body}`);
      case 'commonmark':
        return quote(`**${title}**\n\n${body}`);
    }
  }

  private resource(r: Resource, kind: string, image = false): string {
    const name = r.name ?? r.fileId;
    const href = r.status === 'ok' || r.status === 'pending' ? this.opts.resolveResource?.(r) : undefined;
    if (href !== undefined) {
      // Alt text is the file name, or the kind ("Generated image") when the provider gave none: ids are not text.
      if (image) return `![${escapeMarkdownInline(r.name ?? kind)}](${destination(href)})`;
      return `${kind}: [${escapeMarkdownInline(name)}](${destination(href)})`;
    }
    const why = r.status === 'expired' ? 'expired' : r.status === 'sandbox-gone' ? 'no longer available' : 'not included';
    return `_\\[${kind} ${why}: ${escapeMarkdownInline(name)}\\]_`;
  }

  /** A note box: an Obsidian callout, or a blockquote with a bold title elsewhere. */
  private note(type: 'warning', body: string, title?: string): string {
    if (this.flavor === 'obsidian') return quote(`[!${type}]${title ? ` ${title}` : ''}\n${body}`);
    return quote(title ? `**${title}**\n\n${body}` : body);
  }
}

function nodesOfTurn(turn: Turn): Node[] {
  return turn.question ? [turn.question, ...turn.responses] : turn.responses;
}

/**
 * "Version i of n" notes for the path's forks. A note belongs to the first node of the chosen version, but when the
 * turn definition filtered that node out (a hidden context message heading a regenerated answer, say), it moves to
 * the next node that is rendered, so a version is never shown without saying it is one.
 */
function versionNotes(c: Conversation, pathNodes: readonly Node[], rendered: ReadonlySet<string>): Map<string, string> {
  const notes = new Map<string, string>();
  let pending: string | undefined;
  for (const node of pathNodes) {
    const siblings = node.parentId === null ? [] : (c.nodes[node.parentId]?.childIds ?? []);
    if (siblings.length > 1) {
      const kind = node.role === 'user' ? 'edited question' : 'regenerated answer';
      pending = `_Version ${siblings.indexOf(node.id) + 1} of ${siblings.length} (${kind})_`;
    }
    if (pending && rendered.has(node.id)) {
      notes.set(node.id, pending);
      pending = undefined;
    }
  }
  return notes;
}

function groupByLabel(nodes: readonly Node[]): Group[] {
  const groups: Group[] = [];
  for (const node of nodes) {
    const label = labelOf(node.role);
    const last = groups.at(-1);
    if (last && last.label === label) last.nodes.push(node);
    else groups.push({ label, nodes: [node] });
  }
  return groups;
}

function labelOf(role: Role): Group['label'] {
  return role === 'tool' ? 'assistant' : role;
}

/** A fenced code block whose fence is longer than any backtick run inside, so the content can never close it. */
function fence(text: string, lang?: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  const info = lang ? lang.replace(/[`\s]/g, '') : '';
  return `${ticks}${info}\n${text.replace(/\r\n?/g, '\n').replace(/\n$/, '')}\n${ticks}`;
}

/** Prefix every line with `> ` (`>` for empty lines). */
function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l === '' ? '>' : `> ${l}`))
    .join('\n');
}

function link(text: string, url: string): string {
  return `[${escapeMarkdownInline(text)}](${destination(url)})`;
}

/** A link destination that survives spaces, parentheses and angle brackets in every flavor. */
function destination(url: string): string {
  return url.replace(/[ ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function trimEnd(s: string): string {
  return s.replace(/\s+$/, '');
}
