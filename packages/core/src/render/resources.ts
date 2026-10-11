import MarkdownIt from 'markdown-it';
import type { Conversation, Resource } from '../model/schema.ts';
import { activePath, nodesOf } from '../model/tree.ts';
import { TURN_PRESETS, applyTurnDefinition, buildTurns, type TurnDefinition } from '../model/turns.ts';
import { safeFileName, uniqueFileName } from '../output/filenames.ts';
import { escapeMarkdownInline } from './markdown/text.ts';
import { nodesOfTurn } from './layout.ts';

/**
 * "Resources by turn" (Build Plan §8): only the things a chat produced or used, sorted into one folder per turn.
 * Core plans the layout and writes every text file; the host downloads the files (uploads, images, tool output files)
 * to the paths given and reports the ones it could not get.
 *
 * Layout: `turn-03/` per turn, holding its files, code blocks (one file each, with the language's extension), canvas
 * documents (`.md`) and `links.md` (links and citations); `index.md` lists everything; `resources.json` is the
 * machine-readable list.
 *
 * @packageDocumentation
 */

export type ResourceItem =
  | { kind: 'file'; turn: number; path: string; resource: Resource; label: string }
  | { kind: 'code'; turn: number; path: string; lang?: string; origin: 'answer' | 'tool' | 'question'; text: string }
  | { kind: 'toolOutput'; turn: number; path: string; text: string }
  | { kind: 'canvas'; turn: number; path: string; title: string; text: string }
  | { kind: 'links'; turn: number; path: string; links: { url: string; title?: string; citation: boolean }[] };

export interface ResourcePlan {
  conversationId: string;
  title: string;
  items: ResourceItem[];
}

export interface ResourcePlanOptions {
  /** Default: the active path. */
  path?: readonly string[];
  /** Only these turns. Default: all. */
  selectedTurns?: readonly number[];
  /** Default `TURN_PRESETS.fullArchive`. Images and attachments follow its toggles. */
  turns?: TurnDefinition;
}

const parser = new MarkdownIt('commonmark', { html: false, linkify: true }).enable('linkify');

/** File extension for a code block's language; `.txt` when unknown. */
export function codeExtension(lang: string | undefined): string {
  const l = (lang ?? '').toLowerCase();
  return CODE_EXT[l] ?? '.txt';
}

const CODE_EXT: Record<string, string> = {
  python: '.py', py: '.py', python3: '.py', javascript: '.js', js: '.js', mjs: '.mjs', typescript: '.ts', ts: '.ts',
  tsx: '.tsx', jsx: '.jsx', json: '.json', bash: '.sh', sh: '.sh', shell: '.sh', shellscript: '.sh', zsh: '.zsh',
  powershell: '.ps1', ps1: '.ps1', html: '.html', css: '.css', scss: '.scss', sql: '.sql', java: '.java', c: '.c',
  cpp: '.cpp', 'c++': '.cpp', csharp: '.cs', cs: '.cs', 'c#': '.cs', go: '.go', golang: '.go', rust: '.rs', rs: '.rs',
  ruby: '.rb', rb: '.rb', php: '.php', yaml: '.yaml', yml: '.yaml', xml: '.xml', svg: '.svg', markdown: '.md',
  md: '.md', latex: '.tex', tex: '.tex', r: '.r', swift: '.swift', kotlin: '.kt', kt: '.kt', toml: '.toml',
  dockerfile: '.dockerfile', diff: '.diff', ini: '.ini', csv: '.csv', lua: '.lua', perl: '.pl', scala: '.scala',
  haskell: '.hs', matlab: '.m', julia: '.jl', dart: '.dart', vue: '.vue', graphql: '.graphql', makefile: '.mk',
  text: '.txt', plaintext: '.txt', txt: '.txt',
};

/**
 * Plan the resources of one chat path. Pure and deterministic: names are unique per folder, code blocks are numbered
 * in order, and nothing is fetched. A host may change a file item's `path` before writing the index (to add an
 * extension from the downloaded file's type, say); the index and `resources.json` use the paths as they are then.
 *
 * @example
 * ```ts
 * const plan = planResources(conversation, { selectedTurns: [2, 3] });
 * for (const item of plan.items) if (item.kind !== 'file') write(item.path, resourceText(item));
 * write('index.md', renderResourceIndex(plan, statusOf));
 * ```
 */
export function planResources(c: Conversation, options: ResourcePlanOptions = {}): ResourcePlan {
  const def = options.turns ?? TURN_PRESETS.fullArchive;
  const picked = options.selectedTurns ? new Set(options.selectedTurns) : undefined;
  const items: ResourceItem[] = [];
  const turns = buildTurns(nodesOf(c, options.path ?? activePath(c)))
    .filter((t) => !picked || t.index === 0 || picked.has(t.index))
    .map((t) => applyTurnDefinition(t, def));
  for (const turn of turns) {
    const dir = `turn-${String(turn.index).padStart(2, '0')}`;
    const taken = new Set<string>();
    let code = 0;
    let out = 0;
    const links: { url: string; title?: string; citation: boolean }[] = [];
    const addLink = (url: string, title: string | undefined, citation: boolean) => {
      if (!/^https?:/i.test(url)) return;
      const seen = links.find((l) => l.url === url);
      if (!seen) links.push(title ? { url, title, citation } : { url, citation });
      else if (citation) {
        // A citation of a link already in the text: keep one entry, with the citation's title.
        if (title && !seen.citation) seen.title = title;
        seen.citation = true;
      }
    };
    const addCode = (text: string, lang: string | undefined, origin: 'answer' | 'tool' | 'question') => {
      code++;
      const base = origin === 'tool' ? `tool-code-${code}` : `code-${code}`;
      const item: ResourceItem = { kind: 'code', turn: turn.index, path: `${dir}/${uniqueFileName(base, codeExtension(lang), taken)}`, origin, text };
      if (lang) item.lang = lang;
      items.push(item);
    };
    const markdown = (text: string, origin: 'answer' | 'question') => {
      for (const t of parser.parse(text, {})) {
        if (t.type === 'fence' || t.type === 'code_block') addCode(t.content, t.info.trim().split(/\s+/)[0] || undefined, origin);
        for (const child of t.children ?? []) {
          if (child.type === 'link_open') addLink(child.attrGet('href') ?? '', undefined, false);
          if (child.type === 'image') addLink(child.attrGet('src') ?? '', child.content || undefined, false);
        }
      }
    };
    const file = (r: Resource, label: string) => {
      const name = r.name ?? r.fileId;
      const dot = name.lastIndexOf('.');
      const [base, ext] = dot > 0 && name.length - dot <= 8 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      items.push({ kind: 'file', turn: turn.index, path: `${dir}/${uniqueFileName(safeFileName(base), ext, taken)}`, resource: r, label });
    };
    for (const node of nodesOfTurn(turn)) {
      const origin = node.role === 'user' ? 'question' : 'answer';
      for (const b of node.blocks) {
        switch (b.kind) {
          case 'markdown':
            markdown(b.text, origin);
            break;
          case 'code':
            addCode(b.text, b.lang, b.origin === 'tool' ? 'tool' : origin);
            break;
          case 'toolOutput':
            if (b.text.trim()) {
              out++;
              items.push({ kind: 'toolOutput', turn: turn.index, path: `${dir}/${uniqueFileName(`tool-output-${out}`, '.txt', taken)}`, text: b.text });
            }
            for (const f of b.files ?? []) file(f, 'Tool output file');
            break;
          case 'image':
            file(b.resource, b.generated ? 'Generated image' : node.role === 'user' ? 'Uploaded image' : 'Image');
            break;
          case 'attachment':
            file(b.resource, 'Attachment');
            break;
          case 'canvas':
            items.push({ kind: 'canvas', turn: turn.index, path: `${dir}/${uniqueFileName(safeFileName(b.title || 'Canvas'), '.md', taken)}`, title: b.title, text: b.text });
            markdown(b.text, 'answer');
            break;
          case 'citation':
            addLink(b.url, b.title, true);
            break;
          case 'reasoning':
          case 'unknown':
            break;
        }
      }
    }
    if (links.length) items.push({ kind: 'links', turn: turn.index, path: `${dir}/${uniqueFileName('links', '.md', taken)}`, links });
  }
  return { conversationId: c.id, title: c.title, items };
}

/** The text content of a planned item; `undefined` for files, which the host downloads. */
export function resourceText(item: ResourceItem): string | undefined {
  switch (item.kind) {
    case 'code':
    case 'toolOutput':
      return item.text.endsWith('\n') ? item.text : `${item.text}\n`;
    case 'canvas':
      return `# ${escapeMarkdownInline(item.title)}\n\n${item.text.replace(/\s+$/, '')}\n`;
    case 'links':
      return `${item.links.map((l) => `- ${l.citation ? 'Source: ' : ''}[${escapeMarkdownInline(l.title ?? l.url)}](${destination(l.url)})`).join('\n')}\n`;
    case 'file':
      return undefined;
  }
}

/** What happened to a file: saved, or why not. `failed` is a download error the host reports. */
export type FileOutcome = 'saved' | 'expired' | 'sandbox-gone' | 'failed' | 'skipped';

/**
 * `index.md`: every resource by turn, files with their outcome, so nothing missing goes unmentioned. `outcome` gives
 * each file item's result (default: `saved` for `ok`/`pending` resources, else the resource's status).
 */
export function renderResourceIndex(plan: ResourcePlan, outcome: (item: Extract<ResourceItem, { kind: 'file' }>) => FileOutcome = defaultOutcome): string {
  const lines = [`# Resources: ${escapeMarkdownInline(plan.title || 'Untitled chat')}`, ''];
  if (plan.items.length === 0) lines.push('This chat has no files, code, canvas documents or links.', '');
  let turn = -1;
  plan.items.forEach((item, i) => {
    if (item.turn !== turn) {
      turn = item.turn;
      lines.push(`## ${turn === 0 ? 'Context' : `Turn ${turn}`}`, '');
    }
    const href = destination(item.path.split('/').map(encodeURIComponent).join('/'));
    const name = escapeMarkdownInline(item.path.slice(item.path.indexOf('/') + 1));
    switch (item.kind) {
      case 'file': {
        const o = outcome(item);
        lines.push(o === 'saved' ? `- ${item.label}: [${name}](${href})` : `- ${item.label}: ${name} (${OUTCOME_TEXT[o]})`);
        break;
      }
      case 'code':
        lines.push(`- ${item.origin === 'tool' ? 'Tool code' : 'Code'}${item.lang ? ` (${escapeMarkdownInline(item.lang)})` : ''}: [${name}](${href})`);
        break;
      case 'toolOutput':
        lines.push(`- Tool output: [${name}](${href})`);
        break;
      case 'canvas':
        lines.push(`- Canvas: [${name}](${href})`);
        break;
      case 'links':
        lines.push(`- ${item.links.length} link${item.links.length === 1 ? '' : 's'}: [${name}](${href})`);
        break;
    }
    if (plan.items[i + 1]?.turn !== turn) lines.push('');
  });
  return lines.join('\n').replace(/\n+$/, '\n');
}

const OUTCOME_TEXT: Record<FileOutcome, string> = {
  saved: 'saved',
  expired: 'expired: ChatGPT no longer has this file',
  'sandbox-gone': 'no longer available: the code sandbox was reset',
  failed: 'could not be downloaded',
  skipped: 'not included',
};

/** A link destination that survives spaces, parentheses and angle brackets. */
function destination(url: string): string {
  return url.replace(/[ ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function defaultOutcome(item: Extract<ResourceItem, { kind: 'file' }>): FileOutcome {
  const s = item.resource.status;
  return s === 'expired' || s === 'sandbox-gone' ? s : 'saved';
}

/** `resources.json`: the plan with outcomes, without the text bodies (they are in the files). */
export function resourceManifest(plan: ResourcePlan, outcome: (item: Extract<ResourceItem, { kind: 'file' }>) => FileOutcome = defaultOutcome): string {
  const items = plan.items.map((i) => {
    if (i.kind === 'file') return { kind: i.kind, turn: i.turn, path: i.path, label: i.label, fileId: i.resource.fileId, ...(i.resource.name ? { name: i.resource.name } : {}), outcome: outcome(i) };
    if (i.kind === 'code') return { kind: i.kind, turn: i.turn, path: i.path, origin: i.origin, ...(i.lang ? { lang: i.lang } : {}) };
    if (i.kind === 'links') return { kind: i.kind, turn: i.turn, path: i.path, links: i.links };
    return { kind: i.kind, turn: i.turn, path: i.path };
  });
  return JSON.stringify({ format: 'echoes-resources', formatVersion: 1, conversationId: plan.conversationId, title: plan.title, items }, null, 2) + '\n';
}
