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
  uniqueFileName,
  type Conversation,
  type ExportJob,
  type ExportManifest,
  type ExportReason,
  type LineageRef,
  type OutputSink,
  type Resource,
  type Store,
  type CodeHighlighter,
} from '@echoes/core';
import { createShikiHighlighter } from '@echoes/core/highlight';
import { z } from 'zod';
import { toBase64 } from '../bridge/base64';
import type { DownloadedFile } from '../chatgpt/client';

export const ExportSettingsSchema = z.object({
  format: z.enum(['markdown', 'html', 'json']),
  flavor: z.enum(MARKDOWN_FLAVORS as unknown as ['github', 'obsidian', 'commonmark']),
  preset: z.enum(Object.keys(TURN_PRESETS) as [keyof typeof TURN_PRESETS, ...(keyof typeof TURN_PRESETS)[]]),
  /** Download uploads and generated images next to each document. */
  attachments: z.boolean(),
  /** Only the branch the user sees, or every version (edits and regenerations) with what followed it. */
  versions: z.enum(['active', 'all']).default('active'),
  /** With several branches: one document with the shared turns once and a section per branch, or one file each. */
  branchOutput: z.enum(['sections', 'files']).default('sections'),
  /** Look of HTML (and PDF) documents. */
  theme: z.enum(HTML_THEMES as unknown as ['chatgpt', 'article', 'notes', 'print']).default('article'),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'markdown',
  flavor: 'github',
  preset: 'fullArchive',
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

const EXTENSION: Record<ExportSettings['format'], string> = { markdown: '.md', html: '.html', json: '.json' };
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

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
      ...[...toExport, ...unknown].map((c) => ({ id: c.id, title: c.title })),
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

  const final = await runExportJob(job, {
    checkpoints,
    now: options.now,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    exportOne: async (item) => {
      const id = item.conversationId;
      const parsed = parseChatGptConversation(await source.fetchConversation(id));
      const notes = parsed.warnings.map((w: AdapterWarning) => `${w.code}: ${w.message}`);
      const conversation: Conversation = structuredClone(parsed.conversation);
      const lineage = await options.lineage?.(id);
      if (lineage) conversation.lineage = lineage;
      const updatedAt = data.updatedAt[id] || conversation.updatedAt;
      const title = item.title || conversation.title;
      const contentHash = contentFingerprint(conversation);
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
      const files = [doc];
      const links = new Map<string, string>();
      if (settings.attachments) {
        const dir = `${doc.slice(0, -ext.length)}_files`;
        const names = new Set<string>();
        for (const resource of resourcesOf(conversation)) {
          if (links.has(resource.fileId) || resource.status === 'expired' || resource.status === 'sandbox-gone') continue;
          let file: DownloadedFile;
          try {
            file = await source.downloadFile(resource.fileId);
          } catch (e) {
            if (e instanceof Error && (e.name === 'SchedulerCancelledError' || e.name === 'AbortError')) throw e;
            file = { ok: false, reason: e instanceof Error ? e.message : String(e) };
          }
          if (!file.ok) {
            notes.push(`file-unavailable: ${resource.name ?? resource.fileId}: ${file.reason}`);
            continue;
          }
          const name = uniqueFileName(safeFileName(baseName(file.fileName ?? resource.name ?? resource.fileId)), extOf(file, resource), names);
          await sink.write(`${dir}/${name}`, file.bytes);
          files.push(`${dir}/${name}`);
          links.set(resource.fileId, `${encodeURIComponent(dir)}/${encodeURIComponent(name)}`);
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
  const parsed = parseChatGptConversation(await options.source.fetchConversation(chatId));
  const warnings = parsed.warnings.map((w: AdapterWarning) => `${w.code}: ${w.message}`);
  const conversation: Conversation = structuredClone(parsed.conversation);
  const lineage = await options.lineage?.(chatId);
  if (lineage) conversation.lineage = lineage;
  const images = new Map<string, string>();
  if (settings.attachments) {
    for (const resource of imagesOf(conversation)) {
      if (images.has(resource.fileId) || resource.status === 'expired' || resource.status === 'sandbox-gone') continue;
      const file = await options.source.downloadFile(resource.fileId).catch((e: unknown) => {
        if (e instanceof Error && (e.name === 'SchedulerCancelledError' || e.name === 'AbortError')) throw e;
        return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
      });
      if (!file.ok) {
        warnings.push(`file-unavailable: ${resource.name ?? resource.fileId}: ${file.reason}`);
        continue;
      }
      const mime = file.mime ?? resource.mime ?? IMAGE_MIME[extOf(file, resource)] ?? 'application/octet-stream';
      images.set(resource.fileId, `data:${mime};base64,${toBase64(file.bytes)}`);
    }
  }
  const [html] = await renderDocuments(conversation, { ...settings, format: 'html', branchOutput: 'sections' }, (r) => images.get(r.fileId));
  return { title: conversation.title || 'Untitled chat', html: html!, warnings };
}

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

function imagesOf(c: Conversation): Resource[] {
  const out: Resource[] = [];
  for (const n of Object.values(c.nodes)) for (const b of n.blocks) if (b.kind === 'image') out.push(b.resource);
  return out;
}

let highlighter: Promise<CodeHighlighter> | undefined;

/** Shiki, loaded on first use. If it fails to load, code is exported unhighlighted rather than failing the export. */
function getHighlighter(): Promise<CodeHighlighter> {
  highlighter ??= createShikiHighlighter().catch(() => () => undefined);
  return highlighter;
}

/**
 * A chat's documents in the chosen format: one, or with `branchOutput: 'files'` one per picked branch (active
 * first). JSON is always one document holding the whole tree.
 */
export async function renderDocuments(conversation: Conversation, settings: ExportSettings, resolveResource: (r: Resource) => string | undefined): Promise<string[]> {
  if (settings.format === 'json') return [renderJson(conversation)];
  const hasVersions = namedTraversals(conversation).length > 1;
  const picked = selectTraversals(conversation, { mode: settings.versions }).map((t) => ({ name: t.name, nodeIds: t.nodeIds }));
  const split = settings.branchOutput === 'files' && picked.length > 1;
  if (settings.format === 'html') {
    const opts = { turns: TURN_PRESETS[settings.preset], theme: settings.theme, resolveResource, highlight: await getHighlighter() };
    if (split) return picked.map((b) => renderHtml(conversation, { ...opts, path: b.nodeIds, branchName: b.name }));
    return [hasVersions ? renderHtmlBranches(conversation, picked, opts) : renderHtml(conversation, opts)];
  }
  const md = { flavor: settings.flavor, turns: TURN_PRESETS[settings.preset], resolveResource };
  const tree = hasVersions ? `\n## Conversation tree\n\n${renderMermaid(conversation)}` : '';
  if (split) return picked.map((b) => renderMarkdown(conversation, { ...md, path: b.nodeIds, branchName: b.name }) + tree);
  return [hasVersions ? renderMarkdownBranches(conversation, picked, md) + tree : renderMarkdown(conversation, md)];
}

/** Every file a chat references, in tree order. */
function resourcesOf(c: Conversation): Resource[] {
  const out: Resource[] = [];
  const visit = (id: string) => {
    const n = c.nodes[id];
    if (!n) return;
    for (const b of n.blocks) {
      if (b.kind === 'image' || b.kind === 'attachment') out.push(b.resource);
      else if (b.kind === 'toolOutput') out.push(...(b.files ?? []));
    }
    n.childIds.forEach(visit);
  };
  visit(c.rootId);
  return out;
}

/** Saved files become `ok`, so the JSON export says which files are in the folder. */
function markSaved(c: Conversation, saved: ReadonlyMap<string, string>): void {
  for (const r of resourcesOf(c)) if (saved.has(r.fileId)) r.status = 'ok';
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
