import type { Block, Conversation, Node, Resource } from '../../model/schema.ts';
import { activePath, nodesOf } from '../../model/tree.ts';
import { TURN_PRESETS, applyTurnDefinition, buildTurns, type TurnDefinition } from '../../model/turns.ts';
import { convertMath } from './math.ts';

/**
 * Target Markdown dialect.
 * - `github`: YAML front matter, blockquote notes, `$`/`$$` math (GitHub, Pandoc, Typora, VS Code).
 * - `obsidian`: the same, with callouts for notes and collapsed reasoning.
 * - `commonmark`: no front matter (CommonMark has none); metadata goes in a list under the title.
 */
export type MarkdownFlavor = 'github' | 'obsidian' | 'commonmark';

export interface MarkdownOptions {
  /** Default `github`. */
  flavor?: MarkdownFlavor;
  /** Node ids from the root to a leaf: which traversal to export. Default: the active path. */
  path?: readonly string[];
  /** Which parts of each turn to include. Default: {@link TURN_PRESETS}.fullArchive. */
  turns?: TurnDefinition;
  /** Default: on, except for `commonmark`. */
  frontMatter?: boolean;
  /**
   * Where an exported file lives, relative to the Markdown file, or undefined when it was not exported. Without it,
   * images and attachments are listed as "not included", never linked to a provider URL that will expire.
   */
  resourceHref?: (resource: Resource) => string | undefined;
}

/**
 * Render one traversal of a conversation as Markdown. Deterministic: the same input always gives the same bytes,
 * and nothing in the output depends on the time of export.
 *
 * Layout: front matter (title, dates, model, Project, source, id), `# title`, then `## Turn N` with `### Question`
 * and `### Answer`, and the turn's cited sources at the end of its answer. Math delimiters are converted outside
 * code (see {@link convertMath}). Content an adapter could not map is shown as a raw JSON block, never dropped, and
 * a path with history that was not fetched says so.
 *
 * @example
 * ```ts
 * const md = renderMarkdown(conversation, { flavor: 'obsidian', turns: TURN_PRESETS.studyNotes });
 * ```
 */
export function renderMarkdown(conversation: Conversation, options: MarkdownOptions = {}): string {
  const flavor = options.flavor ?? 'github';
  const def = options.turns ?? TURN_PRESETS.fullArchive;
  const path = options.path ?? activePath(conversation);
  const ctx: Ctx = { flavor, href: options.resourceHref ?? (() => undefined) };
  const parts: string[] = [];

  const meta = metadata(conversation);
  if (options.frontMatter ?? flavor !== 'commonmark') {
    parts.push(['---', ...meta.map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'].join('\n'));
  }
  parts.push(`# ${oneLine(conversation.title) || 'Untitled conversation'}`);
  if (flavor === 'commonmark') parts.push(meta.filter(([k]) => k !== 'title').map(([k, v]) => `- ${k}: ${v}`).join('\n'));

  const pathNodes = nodesOf(conversation, path);
  if (pathNodes[0]?.notFetched === 'earlier-messages') parts.push(note(ctx, 'Earlier messages of this chat were not loaded, so the export starts later.'));

  for (const turn of buildTurns(pathNodes).map((t) => applyTurnDefinition(t, def))) {
    if (!turn.question && turn.responses.length === 0) continue;
    parts.push(turn.index === 0 ? '## Context' : `## Turn ${turn.index}`);
    if (turn.question) parts.push('### Question', ...nodeBlocks(turn.question, ctx));
    if (turn.responses.length) {
      parts.push('### Answer', ...turn.responses.flatMap((n) => nodeBlocks(n, ctx)));
      const sources = citations(turn.responses);
      if (sources.length) parts.push('**Sources**', sources.join('\n'));
    }
  }

  if (pathNodes.at(-1)?.notFetched === 'later-messages') {
    parts.push(note(ctx, 'Later messages under this version exist in the chat but were not loaded.'));
  }
  return parts.filter((p) => p !== '').join('\n\n') + '\n';
}

interface Ctx {
  flavor: MarkdownFlavor;
  href: (r: Resource) => string | undefined;
}

function metadata(c: Conversation): [string, string][] {
  const m: [string, string][] = [['title', c.title], ['created', c.createdAt], ['updated', c.updatedAt]];
  if (c.model) m.push(['model', c.model]);
  if (c.projectId) m.push(['project', c.projectId]);
  m.push(['source', c.sourceUrl], ['conversation_id', c.id]);
  return m;
}

function nodeBlocks(node: Node, ctx: Ctx): string[] {
  const out = node.blocks.map((b) => block(b, ctx)).filter((s) => s !== '');
  if (node.hidden && out.length) out.unshift('*Hidden context:*');
  return out;
}

function block(b: Block, ctx: Ctx): string {
  switch (b.kind) {
    case 'markdown':
      return convertMath(b.text).trim();
    case 'code':
      return (b.origin === 'tool' ? '**Tool call**\n\n' : '') + fenced(b.text, b.lang ?? '');
    case 'toolOutput':
      return '**Tool output**\n\n' + fenced(b.text, 'text');
    case 'reasoning':
      return ctx.flavor === 'obsidian'
        ? quote(`[!abstract]- Reasoning summary\n${b.summary}`)
        : quote(`**Reasoning summary:** ${b.summary}`);
    case 'image': {
      const label = `${b.generated ? 'Generated image' : 'Image'}: ${b.resource.name ?? b.resource.fileId}`;
      const href = ctx.href(b.resource);
      return href ? `![${escapeText(label)}](${destination(href)})` : `*[${escapeText(label)}, not included (${b.resource.status})]*`;
    }
    case 'attachment': {
      const label = b.resource.name ?? b.resource.fileId;
      const href = ctx.href(b.resource);
      return href ? `[${escapeText(label)}](${destination(href)})` : `*[Attachment: ${escapeText(label)}, not included (${b.resource.status})]*`;
    }
    case 'citation':
      return ''; // collected per turn under "Sources"
    case 'canvas':
      return `**Canvas: ${escapeText(oneLine(b.title))}**\n\n${convertMath(b.text).trim()}`;
    case 'unknown':
      return `**Unknown content (${escapeText(b.contentType)})**, kept as raw data:\n\n` + fenced(JSON.stringify(b.raw, null, 2) ?? 'undefined', 'json');
  }
}

function citations(nodes: readonly Node[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of nodes) {
    for (const b of n.blocks) {
      if (b.kind !== 'citation' || seen.has(b.url)) continue;
      seen.add(b.url);
      out.push(`${out.length + 1}. [${escapeText(oneLine(b.title ?? b.url))}](${destination(b.url)})`);
    }
  }
  return out;
}

function note(ctx: Ctx, text: string): string {
  return ctx.flavor === 'obsidian' ? quote(`[!warning] Incomplete\n${text}`) : quote(`**Note:** ${text}`);
}

/** A fence longer than any backtick run in the text, so code containing ``` stays inside its block. */
function fenced(text: string, lang: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${text.replace(/\n$/, '')}\n${fence}`;
}

function quote(text: string): string {
  return text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

/** Escape characters that would start Markdown syntax inside link text or a label. */
function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]<>$])/g, '\\$1');
}

/** Link destinations with spaces or parentheses go in angle brackets. */
function destination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}
