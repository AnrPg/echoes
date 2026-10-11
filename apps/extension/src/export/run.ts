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
} from '@echoes/core';
import { z } from 'zod';
import type { DownloadedFile } from '../chatgpt/client';

export const ExportSettingsSchema = z.object({
  format: z.enum(['markdown', 'json']),
  flavor: z.enum(MARKDOWN_FLAVORS as unknown as ['github', 'obsidian', 'commonmark']),
  preset: z.enum(Object.keys(TURN_PRESETS) as [keyof typeof TURN_PRESETS, ...(keyof typeof TURN_PRESETS)[]]),
  /** Download uploads and generated images next to each document. */
  attachments: z.boolean(),
  /** Only the branch the user sees, or every version (edits and regenerations) with what followed it. */
  versions: z.enum(['active', 'all']).default('active'),
  /** With several branches: one document with the shared turns once and a section per branch, or one file each. */
  branchOutput: z.enum(['sections', 'files']).default('sections'),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'markdown',
  flavor: 'github',
  preset: 'fullArchive',
  attachments: true,
  versions: 'active',
  branchOutput: 'sections',
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

const EXTENSION: Record<ExportSettings['format'], string> = { markdown: '.md', json: '.json' };
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

      const all = namedTraversals(conversation);
      const hasVersions = all.length > 1;
      const base = doc.slice(0, -ext.length);
      if (settings.format === 'json') {
        await sink.write(doc, renderJson(conversation)); // the whole tree, every version
      } else {
        const md = {
          flavor: settings.flavor,
          turns: TURN_PRESETS[settings.preset],
          resolveResource: (r: Resource) => links.get(r.fileId),
        };
        const picked = selectTraversals(conversation, { mode: settings.versions }).map((t) => ({ name: t.name, nodeIds: t.nodeIds }));
        const tree = hasVersions ? `\n## Conversation tree\n\n${renderMermaid(conversation)}` : '';
        if (settings.branchOutput === 'files' && picked.length > 1) {
          for (const [i, b] of picked.entries()) {
            const name = i === 0 ? doc : `${base} (branch ${i + 1})${ext}`;
            await sink.write(name, renderMarkdown(conversation, { ...md, path: b.nodeIds, branchName: b.name }) + tree);
            if (i > 0) files.splice(i, 0, name);
          }
        } else if (hasVersions) {
          await sink.write(doc, renderMarkdownBranches(conversation, picked, md) + tree);
        } else {
          await sink.write(doc, renderMarkdown(conversation, md));
        }
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
