// The export runner: list → incremental plan → resumable job → per chat: fetch, parse, download files, render,
// write, record in manifest.json. Host-specific pieces (ChatGPT access, output, storage, clock) are injected, so
// the same runner serves single-chat and bulk export and is tested without a browser.

import {
  parseChatGptConversation,
  type AdapterWarning,
  type ChatGptConversationCapture,
  type ChatListItem,
} from '@echoes/adapter-chatgpt-api';
import {
  JobCheckpoints,
  MANIFEST_PATH,
  MARKDOWN_FLAVORS,
  TURN_PARTS,
  TURN_PRESETS,
  contentFingerprint,
  createExportJob,
  documentFileName,
  emptyManifest,
  exportSettingsKey,
  isContentUnchanged,
  parseManifest,
  planIncrementalExport,
  recordExport,
  HTML_THEMES,
  renderHtml,
  renderHtmlBranches,
  renderJson,
  namedTraversals,
  renderMarkdown,
  renderMarkdownBranches,
  renderMermaid,
  runExportJob,
  selectTraversals,
  treeSummary,
  safeFileName,
  serializeManifest,
  linkPath,
  slugFileName,
  uniqueSlugName,
  type Conversation,
  type ExportJob,
  type ExportManifest,
  type ExportReason,
  type LineageRef,
  type OutputSink,
  type Resource,
  type Store,
  type CodeHighlighter,
  type TurnDefinition,
  type TurnPresetName,
  type ChatSkeleton,
  ChatSkeletonSchema,
  STORE_COLLECTIONS,
  buildTurns,
  chatSkeleton,
  inferLineage,
  lineageFromMetadata,
  nodesOf,
  activePath,
  planResources,
  renderResourceIndex,
  resourceManifest,
  resourceText,
  type FileOutcome,
  type ResourceItem,
} from '@echoes/core';
import { createShikiHighlighter } from '@echoes/core/highlight';
import { z } from 'zod';
import { toBase64 } from '../bridge/base64';
import { loadChat } from './load';

export { loadChat };
import type { DownloadedFile } from '../chatgpt/client';

const TurnDefinitionSchema = z.object(Object.fromEntries(TURN_PARTS.map((k) => [k, z.boolean()])) as Record<keyof TurnDefinition, z.ZodBoolean>);

/** Settings saved before the parts of a turn could be mixed freely held a preset name; it becomes that preset's parts. */
function upgradeSettings(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('preset' in raw)) return raw;
  const { preset, ...rest } = raw as Record<string, unknown>;
  const from = TURN_PRESETS[preset as TurnPresetName] ?? TURN_PRESETS.fullArchive;
  return { ...rest, turns: { ...from } };
}

export const ExportSettingsSchema = z.preprocess(upgradeSettings, z.object({
  /** `resources`: only files, code, canvas documents and links, in one folder per turn (no conversation text). */
  format: z.enum(['markdown', 'html', 'json', 'resources']),
  flavor: z.enum(MARKDOWN_FLAVORS as unknown as ['github', 'obsidian', 'commonmark']),
  /** Which parts of each turn to include, in any combination. The presets in `TURN_PRESETS` are defaults for these. */
  turns: TurnDefinitionSchema,
  /** Download uploads and generated images next to each document. */
  attachments: z.boolean(),
  /** Only the branch the user sees, or every version (edits and regenerations) with what followed it. */
  versions: z.enum(['active', 'all']).default('active'),
  /** With several branches: one document with the shared turns once and a section per branch, or one file each. */
  branchOutput: z.enum(['sections', 'files']).default('sections'),
  /** Look of HTML (and PDF) documents. */
  theme: z.enum(HTML_THEMES as unknown as ['chatgpt', 'article', 'notes', 'print']).default('article'),
}));
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'markdown',
  flavor: 'github',
  turns: { ...TURN_PRESETS.fullArchive },
  attachments: true,
  versions: 'active',
  branchOutput: 'sections',
  theme: 'article',
};

export const REPORT_PATH = 'echoes-report.json';

/** What the runner needs from ChatGPT (the ChatGptClient, or a fake in tests). */
export interface ChatSource {
  fetchConversation(id: string): Promise<ChatGptConversationCapture>;
  downloadFile(fileId: string): Promise<DownloadedFile>;
  /** Files outside ChatGPT's file store (`Resource.url`, an image ChatGPT found on the web). Optional. */
  downloadUrl?(url: string): Promise<DownloadedFile>;
}

export interface ExportRunOptions {
  source: ChatSource;
  sink: OutputSink;
  store: Store;
  /** ISO time. */
  now: () => string;
  /** The recorded "Branch in new chat" link for a chat, from the branch monitor's log. */
  lineage?: (conversationId: string) => Promise<LineageRef | undefined>;
  onProgress?: (job: ExportJob) => void;
}

export interface NewExportOptions {
  /** Re-fetch chats last verified before this instant (see planIncrementalExport). */
  recheckBefore?: string;
  /** Chat ids to export whatever the manifest says. */
  force?: string[];
  /** Ignore the manifest: export every chat again. */
  reexportAll?: boolean;
}

export interface ExportReport {
  job: ExportJob;
  /** Why each exported chat was exported. */
  reasons: Record<string, ExportReason>;
  /** Adapter warnings and files that could not be saved, per chat. Nothing listed here was dropped silently. */
  warnings: Record<string, string[]>;
  /** Chats that were re-checked and found identical, so their files were left as they were. */
  verified: string[];
}

/** Stored in the job, so a resumed job writes the same manifest entries. */
const JobDataSchema = z.object({
  settings: ExportSettingsSchema,
  updatedAt: z.record(z.string(), z.string()),
});

// A resources export is a folder per chat; its index.md is the chat's main file.
const EXTENSION: Record<ExportSettings['format'], string> = { markdown: '.md', html: '.html', json: '.json', resources: '/index.md' };
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const byCreation = (a: ChatListItem, b: ChatListItem) => ((a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : 0);

async function readManifest(sink: OutputSink): Promise<ExportManifest> {
  const text = await sink.readText?.(MANIFEST_PATH);
  return text === undefined ? emptyManifest() : parseManifest(text);
}

/** Start a new export of `chats`. Unchanged chats (per manifest.json in the sink) are skipped. */
export async function exportChats(
  chats: readonly ChatListItem[],
  settings: ExportSettings,
  jobId: string,
  options: ExportRunOptions,
  plan: NewExportOptions = {},
): Promise<ExportReport> {
  const key = exportSettingsKey(settings);
  const manifest = plan.reexportAll ? emptyManifest() : await readManifest(options.sink);
  const planOptions: { recheckBefore?: string; force?: string[] } = {};
  if (plan.recheckBefore) planOptions.recheckBefore = plan.recheckBefore;
  if (plan.force) planOptions.force = plan.force;
  // A single-chat export may not know the list values yet; such chats are always exported.
  const { toExport, unchanged, reasons } = planIncrementalExport(manifest, chats.filter((c) => c.updatedAt), key, planOptions);
  const unknown = chats.filter((c) => !c.updatedAt);
  for (const c of unknown) reasons[c.id] = 'new';
  const job = createExportJob({
    id: jobId,
    now: options.now(),
    settings: { settings, updatedAt: Object.fromEntries(chats.map((c) => [c.id, c.updatedAt])) },
    conversations: [
      // Oldest first, so a chat's source is usually exported (and known for lineage) before the chat itself.
      ...[...toExport, ...unknown].sort(byCreation).map((c) => ({ id: c.id, title: c.title })),
      ...unchanged.map((c) => ({ id: c.id, title: c.title, skip: true })),
    ],
  });
  return run(job, reasons, options, plan.reexportAll ? emptyManifest() : manifest);
}

/** Continue a stopped or interrupted job from its checkpoint. */
export async function resumeExport(jobId: string, options: ExportRunOptions): Promise<ExportReport> {
  const job = await new JobCheckpoints(options.store).load(jobId);
  if (!job) throw new Error(`no saved export "${jobId}"`);
  return run({ ...job, cancelled: false }, {}, options, await readManifest(options.sink));
}

async function run(job: ExportJob, reasons: Record<string, ExportReason>, options: ExportRunOptions, startManifest: ExportManifest): Promise<ExportReport> {
  const { source, sink, store } = options;
  const data = JobDataSchema.parse(job.settings);
  const { settings } = data;
  const key = exportSettingsKey(settings);
  const ext = EXTENSION[settings.format];
  const checkpoints = new JobCheckpoints(store);
  let manifest = startManifest;
  const taken = new Set<string>();
  const warnings: Record<string, string[]> = {};
  const verified: string[] = [];
  const skeletons = await loadSkeletons(store);

  const final = await runExportJob(job, {
    checkpoints,
    now: options.now,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    exportOne: async (item) => {
      const id = item.conversationId;
      const parsed = parseChatGptConversation(await source.fetchConversation(id));
      const notes = parsed.warnings.map((w: AdapterWarning) => `${w.code}: ${w.message}`);
      const conversation: Conversation = structuredClone(parsed.conversation);
      const updatedAt = data.updatedAt[id] || conversation.updatedAt;
      const title = item.title || conversation.title;
      const lineage = await findLineage(conversation, parsed.branchedFrom, (await options.lineage?.(id)), skeletons, options.now(), notes);
      if (lineage) conversation.lineage = lineage;
      skeletons.set(id, chatSkeleton(conversation));
      await store.put(STORE_COLLECTIONS.skeletons, id, skeletons.get(id));
      // detectedAt of an inferred link is the time of this run; it must not make an unchanged chat look changed.
      const contentHash = contentFingerprint(lineage ? { ...conversation, lineage: { ...lineage, detectedAt: '' } } : conversation);
      const previous = manifest.conversations[id];
      const entry = { title, updatedAt, activeLeafId: conversation.activeLeafId, settingsKey: key, contentHash, exportedAt: options.now() };

      if (previous && isContentUnchanged(previous, key, contentHash)) {
        verified.push(id);
        manifest = recordExport(manifest, id, { ...entry, files: previous.files });
        await sink.write(MANIFEST_PATH, serializeManifest(manifest));
        if (notes.length) warnings[id] = notes;
        return { files: previous.files };
      }

      const doc = documentFileName(manifest, { id, title }, ext, taken);
      if (settings.format === 'resources') {
        const folder = doc.slice(0, -ext.length);
        const files = await writeResources(conversation, settings, { path: activePath(conversation), turns: settings.turns }, source, sink, folder, notes);
        manifest = recordExport(manifest, id, { ...entry, files });
        await sink.write(MANIFEST_PATH, serializeManifest(manifest));
        if (notes.length) warnings[id] = notes;
        return { files };
      }
      const files = [doc];
      const links = new Map<string, string>();
      if (settings.attachments) {
        const dir = filesFolder(doc.slice(0, -ext.length));
        const names = new Set<string>();
        for (const { resource } of resourcesOf(conversation)) {
          if (links.has(resource.fileId) || resource.status === 'expired' || resource.status === 'sandbox-gone') continue;
          const file = await fetchFile(source, resource);
          if (!file.ok) {
            notes.push(`file-unavailable: ${resource.name ?? resource.fileId}: ${file.reason}`);
            continue;
          }
          const name = uniqueSlugName(fileBase(file, resource), extOf(file, resource), names);
          await sink.write(`${dir}/${name}`, file.bytes);
          files.push(`${dir}/${name}`);
          links.set(resource.fileId, linkPath(dir, name));
        }
        markSaved(conversation, links);
      }

      const hasVersions = namedTraversals(conversation).length > 1;
      const base = doc.slice(0, -ext.length);
      const docs = await renderDocuments(conversation, settings, (r) => links.get(r.fileId));
      for (const [i, d] of docs.entries()) {
        const name = i === 0 ? doc : `${base} (branch ${i + 1})${ext}`;
        await sink.write(name, d);
        if (i > 0) files.splice(i, 0, name);
      }
      if (hasVersions) {
        await sink.write(`${base}.tree.json`, JSON.stringify(treeSummary(conversation), null, 2) + '\n');
        files.push(`${base}.tree.json`);
      }
      manifest = recordExport(manifest, id, { ...entry, files });
      await sink.write(MANIFEST_PATH, serializeManifest(manifest)); // after every chat: a crash loses nothing done
      if (notes.length) warnings[id] = notes;
      return { files };
    },
  });

  await sink.write(
    REPORT_PATH,
    JSON.stringify(
      {
        generator: 'echoes',
        job: final.id,
        items: final.items.map((i) => ({
          conversationId: i.conversationId,
          title: i.title,
          status: verified.includes(i.conversationId) ? 'verified' : i.status,
          ...(reasons[i.conversationId] ? { reason: reasons[i.conversationId] } : {}),
          ...(i.error ? { error: i.error } : {}),
          ...(warnings[i.conversationId] ? { warnings: warnings[i.conversationId] } : {}),
        })),
      },
      null,
      2,
    ) + '\n',
  );
  return { job: final, reasons, warnings, verified };
}

/** A chat as one HTML page ready to print to PDF: images embedded, so the page needs nothing next to it. */
export interface Printable {
  title: string;
  html: string;
  warnings: string[];
}

/**
 * One chat for "Save as PDF": fetched, images embedded as data URLs (other files show as "not included"), rendered
 * as HTML with the chosen theme and versions in one document. The page prints it with the browser's print engine.
 */
export async function printableChat(chatId: string, settings: ExportSettings, options: Pick<ExportRunOptions, 'source' | 'lineage'>): Promise<Printable> {
  const { conversation, warnings } = await loadChat(chatId, options);
  const page = await printableConversation(conversation, settings, options.source);
  return { ...page, warnings: [...warnings, ...page.warnings] };
}

/** A hand-picked part of one chat, from the turn picker. */
export interface TurnSelection {
  /** Root-to-leaf node ids: the version being shown. */
  path: readonly string[];
  /** 1-based turn indexes along `path`. */
  selectedTurns: readonly number[];
  turns: TurnDefinition;
  branchName?: string;
}

/** Like {@link printableChat}, for a chat already loaded, optionally only the picked turns. */
export async function printableConversation(conversation: Conversation, settings: ExportSettings, source: ChatSource, selection?: TurnSelection): Promise<Printable> {
  const warnings: string[] = [];
  const images = new Map<string, string>();
  if (settings.attachments) {
    for (const resource of resourcesOf(conversation, selection).filter((r) => r.kind === 'image').map((r) => r.resource)) {
      if (images.has(resource.fileId) || resource.status === 'expired' || resource.status === 'sandbox-gone') continue;
      const file = await fetchFile(source, resource);
      if (!file.ok) {
        warnings.push(`file-unavailable: ${resource.name ?? resource.fileId}: ${file.reason}`);
        continue;
      }
      const mime = file.mime ?? resource.mime ?? IMAGE_MIME[extOf(file, resource)] ?? 'application/octet-stream';
      images.set(resource.fileId, `data:${mime};base64,${toBase64(file.bytes)}`);
    }
  }
  const resolve = (r: Resource) => images.get(r.fileId);
  const html = selection
    ? renderHtml(conversation, { ...selectionOptions(selection), theme: settings.theme, resolveResource: resolve, highlight: await getHighlighter() })
    : (await renderDocuments(conversation, { ...settings, format: 'html', branchOutput: 'sections' }, resolve))[0]!;
  return { title: conversation.title || 'Untitled chat', html, warnings };
}

/**
 * Write the picked turns of one chat to `sink`: one document in the chosen format (JSON always holds the whole
 * chat) and, when attachments are on, the files of those turns in `<name>_files/`. Returns warnings.
 */
export async function exportSelection(conversation: Conversation, settings: ExportSettings, selection: TurnSelection, options: { source: ChatSource; sink: OutputSink }): Promise<string[]> {
  const warnings: string[] = [];
  const ext = EXTENSION[settings.format];
  const base = safeFileName(conversation.title || 'Untitled chat');
  if (settings.format === 'resources') {
    await writeResources(conversation, settings, selectionOptions(selection), options.source, options.sink, base, warnings);
    return warnings;
  }
  const links = new Map<string, string>();
  if (settings.attachments && settings.format !== 'json') {
    const dir = filesFolder(base);
    const names = new Set<string>();
    for (const { resource } of resourcesOf(conversation, selection)) {
      if (links.has(resource.fileId) || resource.status === 'expired' || resource.status === 'sandbox-gone') continue;
      const file = await fetchFile(options.source, resource);
      if (!file.ok) {
        warnings.push(`file-unavailable: ${resource.name ?? resource.fileId}: ${file.reason}`);
        continue;
      }
      const name = uniqueSlugName(fileBase(file, resource), extOf(file, resource), names);
      await options.sink.write(`${dir}/${name}`, file.bytes);
      links.set(resource.fileId, linkPath(dir, name));
    }
  }
  const resolveResource = (r: Resource) => links.get(r.fileId);
  let doc: string;
  if (settings.format === 'json') doc = renderJson(conversation);
  else if (settings.format === 'html') doc = renderHtml(conversation, { ...selectionOptions(selection), theme: settings.theme, resolveResource, highlight: await getHighlighter() });
  else doc = renderMarkdown(conversation, { ...selectionOptions(selection), flavor: settings.flavor, resolveResource });
  await options.sink.write(`${base}${ext}`, doc);
  return warnings;
}

function selectionOptions(s: TurnSelection) {
  return { path: s.path, selectedTurns: s.selectedTurns, turns: s.turns, ...(s.branchName ? { branchName: s.branchName } : {}) };
}

async function fetchFile(source: ChatSource, resource: Resource): Promise<DownloadedFile> {
  try {
    if (resource.url) return source.downloadUrl ? await source.downloadUrl(resource.url) : { ok: false, reason: 'this host does not download web images' };
    return await source.downloadFile(resource.fileId);
  } catch (e) {
    if (e instanceof Error && (e.name === 'SchedulerCancelledError' || e.name === 'AbortError')) throw e;
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

let highlighter: Promise<CodeHighlighter> | undefined;

/** Shiki, loaded on first use. If it fails to load, code is exported unhighlighted rather than failing the export. */
export function getHighlighter(): Promise<CodeHighlighter> {
  highlighter ??= createShikiHighlighter().catch(() => () => undefined);
  return highlighter;
}

/**
 * A chat's documents in the chosen format: one, or with `branchOutput: 'files'` one per picked branch (active
 * first). JSON is always one document holding the whole tree.
 */
export async function renderDocuments(conversation: Conversation, settings: ExportSettings, resolveResource: (r: Resource) => string | undefined): Promise<string[]> {
  if (settings.format === 'json') return [renderJson(conversation)];
  if (settings.format === 'resources') throw new Error('resources are written by writeResources, not rendered as documents');
  const hasVersions = namedTraversals(conversation).length > 1;
  const picked = selectTraversals(conversation, { mode: settings.versions }).map((t) => ({ name: t.name, nodeIds: t.nodeIds }));
  const split = settings.branchOutput === 'files' && picked.length > 1;
  if (settings.format === 'html') {
    const opts = { turns: settings.turns, theme: settings.theme, resolveResource, highlight: await getHighlighter() };
    if (split) return picked.map((b) => renderHtml(conversation, { ...opts, path: b.nodeIds, branchName: b.name }));
    return [hasVersions ? renderHtmlBranches(conversation, picked, opts) : renderHtml(conversation, opts)];
  }
  const md = { flavor: settings.flavor, turns: settings.turns, resolveResource };
  const tree = hasVersions ? `\n## Conversation tree\n\n${renderMermaid(conversation)}` : '';
  if (split) return picked.map((b) => renderMarkdown(conversation, { ...md, path: b.nodeIds, branchName: b.name }) + tree);
  return [hasVersions ? renderMarkdownBranches(conversation, picked, md) + tree : renderMarkdown(conversation, md)];
}

/**
 * Resources by turn into `folder`: code, tool output, canvas and link files from core's plan, the files downloaded
 * (unless attachments are off), then `index.md` and `resources.json` saying what happened to each. Returns the paths
 * written, `index.md` first.
 */
async function writeResources(
  c: Conversation,
  settings: ExportSettings,
  options: { path: readonly string[]; turns: TurnDefinition; selectedTurns?: readonly number[] },
  source: ChatSource,
  sink: OutputSink,
  folder: string,
  notes: string[],
): Promise<string[]> {
  const plan = planResources(c, options);
  const written: string[] = [];
  const outcomes = new Map<ResourceItem, FileOutcome>();
  for (const item of plan.items) {
    if (item.kind !== 'file') {
      await sink.write(`${folder}/${item.path}`, resourceText(item)!);
      written.push(`${folder}/${item.path}`);
      continue;
    }
    const r = item.resource;
    if (r.status === 'expired' || r.status === 'sandbox-gone') {
      outcomes.set(item, r.status);
      continue;
    }
    if (!settings.attachments) {
      outcomes.set(item, 'skipped');
      continue;
    }
    const file = await fetchFile(source, r);
    if (!file.ok) {
      notes.push(`file-unavailable: ${r.name ?? r.fileId}: ${file.reason}`);
      outcomes.set(item, 'failed');
      continue;
    }
    // A file the chat names without an extension (a generated image, say) gets one from its download.
    if (!/\.[^./]{1,8}$/.test(item.path)) item.path += extOf(file, r);
    await sink.write(`${folder}/${item.path}`, file.bytes);
    written.push(`${folder}/${item.path}`);
    outcomes.set(item, 'saved');
  }
  const outcome = (i: ResourceItem) => outcomes.get(i) ?? 'saved';
  await sink.write(`${folder}/index.md`, renderResourceIndex(plan, outcome));
  await sink.write(`${folder}/resources.json`, resourceManifest(plan, outcome));
  return [`${folder}/index.md`, `${folder}/resources.json`, ...written];
}

async function loadSkeletons(store: Store): Promise<Map<string, ChatSkeleton>> {
  const out = new Map<string, ChatSkeleton>();
  for (const key of await store.keys(STORE_COLLECTIONS.skeletons)) {
    const r = ChatSkeletonSchema.safeParse(await store.get(STORE_COLLECTIONS.skeletons, key));
    if (r.success) out.set(key, r.data);
  }
  return out;
}

/**
 * The chat's "Branch in new chat" link, best evidence first: recorded live by the branch monitor; named by ChatGPT's
 * own metadata (the fork found in the source's skeleton); or inferred from the longest shared start with a chat
 * exported before. A source ChatGPT names but Echoes has not seen yet is reported, not guessed.
 */
async function findLineage(
  c: Conversation,
  branchedFrom: { conversationId: string; title?: string } | undefined,
  recorded: LineageRef | undefined,
  skeletons: ReadonlyMap<string, ChatSkeleton>,
  now: string,
  notes: string[],
): Promise<LineageRef | undefined> {
  if (recorded) return recorded;
  const me = chatSkeleton(c);
  if (branchedFrom) {
    const parent = skeletons.get(branchedFrom.conversationId);
    const link = parent && lineageFromMetadata(me, parent, now);
    if (!link) notes.push(`branched-from: made from "${branchedFrom.title ?? branchedFrom.conversationId}" with Branch in new chat; export that chat too to link the two`);
    return link;
  }
  return inferLineage(me, skeletons.values(), { now });
}

/** Every file a chat references, in tree order; with a selection, only those in its picked turns along its path. */
function resourcesOf(c: Conversation, selection?: TurnSelection): { kind: 'image' | 'attachment' | 'file'; resource: Resource }[] {
  const out: { kind: 'image' | 'attachment' | 'file'; resource: Resource }[] = [];
  const collect = (n: Conversation['nodes'][string]) => {
    for (const b of n.blocks) {
      if (b.kind === 'image' || b.kind === 'attachment') out.push({ kind: b.kind, resource: b.resource });
      else if (b.kind === 'toolOutput') out.push(...(b.files ?? []).map((resource) => ({ kind: 'file' as const, resource })));
    }
  };
  if (selection) {
    const picked = new Set(selection.selectedTurns);
    for (const t of buildTurns(nodesOf(c, selection.path))) {
      if (t.index === 0 || picked.has(t.index)) for (const n of t.question ? [t.question, ...t.responses] : t.responses) collect(n);
    }
    return out;
  }
  const visit = (id: string) => {
    const n = c.nodes[id];
    if (!n) return;
    collect(n);
    n.childIds.forEach(visit);
  };
  visit(c.rootId);
  return out;
}

/** Saved files become `ok`, so the JSON export says which files are in the folder. */
function markSaved(c: Conversation, saved: ReadonlyMap<string, string>): void {
  for (const { resource: r } of resourcesOf(c)) if (saved.has(r.fileId)) r.status = 'ok';
}

/** A saved file's name without extension. A web image's name is its description, not a file name: kept whole, shortened. */
/**
 * The folder for a document's images and attachments: a plain name without spaces or brackets, since documents link
 * into it and some Markdown viewers fail on those characters in a link ("My chat.md" → "my-chat_files/").
 */
function filesFolder(documentBase: string): string {
  return `${slugFileName(documentBase)}_files`;
}

function fileBase(file: Extract<DownloadedFile, { ok: true }>, resource: Resource): string {
  if (resource.url && !file.fileName) return safeFileName(resource.name ?? 'image', { maxBytes: 120 });
  return safeFileName(baseName(file.fileName ?? resource.name ?? resource.fileId));
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function extOf(file: Extract<DownloadedFile, { ok: true }>, resource: Resource): string {
  const name = file.fileName ?? resource.name ?? '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && name.length - dot <= 6) return name.slice(dot).toLowerCase();
  return MIME_EXT[file.mime ?? resource.mime ?? ''] ?? '';
}
