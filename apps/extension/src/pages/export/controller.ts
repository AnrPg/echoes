// Everything the export page does that is not drawing: finding the ChatGPT tab, the one request queue, storage,
// output targets and running jobs. The UI (app.tsx) only calls into this.

import type { ChatListItem } from '@echoes/adapter-chatgpt-api';
import { JobCheckpoints, MemoryStore, Scheduler, cancelExportJob, isJobFinished, type Conversation, type ExportJob, type OutputSink, type SchedulerEvent, type TurnDefinition } from '@echoes/core';
import { tabContext, type TabContext } from '../../background/routes';
import { BridgeLink, bridgeTransport } from '../../bridge/link';
import { BRIDGE_PORT } from '../../bridge/protocol';
import { ChatGptClient, type BridgeResponse } from '../../chatgpt/client';
import {
  DEFAULT_SETTINGS,
  ExportSettingsSchema,
  exportChats,
  exportSelection,
  loadChat,
  printableChat,
  printableConversation,
  resumeExport,
  type ExportReport,
  type ExportSettings,
  type TurnSelection,
} from '../../export/run';
import { selfTest, type SelfTestResult } from '../../export/self-test';
import { IndexedDbStore } from '../../host/idb-store';
import { keepTabsAwake } from '../../host/keep-awake';
import { lineageFor } from '../../host/lineage';
import { DownloadSink, FolderSink, ZipSink, type DirectoryHandleLike } from '../../host/sinks';
import { backgroundSafeClock } from '../../host/worker-clock';

const ORIGIN = 'https://chatgpt.com';
const SETTINGS_KEY = 'echoes:export-settings';
const PRESETS_KEY = 'echoes:turn-presets';

/** A turn definition the user saved under a name in the turn picker. */
export interface SavedPreset {
  name: string;
  turns: TurnDefinition;
}

declare global {
  interface Window {
    showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike & { name: string }>;
    showSaveFilePicker?: (o?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
      createWritable(): Promise<WritableStream<Uint8Array>>;
    }>;
  }
}

export interface PageSettings extends ExportSettings {
  /** Re-check chats not verified for this many days (0 = never). */
  recheckDays: number;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = { ...DEFAULT_SETTINGS, recheckDays: 30 };

export interface ChatGroup {
  /** Undefined for chats outside Projects. */
  projectId?: string;
  name: string;
  chats: ChatListItem[];
}

export type OutputTarget = { kind: 'folder'; sink: FolderSink; name: string } | { kind: 'zip'; sink: ZipSink; name: string };

export class ExportController {
  readonly link: BridgeLink;
  readonly scheduler: Scheduler<BridgeResponse>;
  readonly client: ChatGptClient;
  readonly store = new IndexedDbStore();
  readonly checkpoints = new JobCheckpoints(this.store);
  #tabId: number | undefined;

  constructor(tabId: number | undefined) {
    this.#tabId = tabId;
    this.link = new BridgeLink(() => {
      if (this.#tabId === undefined) throw new Error('no ChatGPT tab');
      return chrome.tabs.connect(this.#tabId, { name: BRIDGE_PORT });
    });
    // The clock runs in a worker so a bulk export keeps its pace while this tab is hidden.
    this.scheduler = new Scheduler<BridgeResponse>({ transport: bridgeTransport(this.link), clock: backgroundSafeClock() });
    this.client = new ChatGptClient({ origin: ORIGIN, scheduler: this.scheduler, learned: () => this.link.learned() });
  }

  /** Use the given tab if it is still a ChatGPT tab, else any open ChatGPT tab. */
  async findTab(): Promise<boolean> {
    if (this.#tabId !== undefined) {
      const tab = await chrome.tabs.get(this.#tabId).catch(() => undefined);
      if (tab?.url?.startsWith(`${ORIGIN}/`)) return true;
    }
    const [tab] = await chrome.tabs.query({ url: `${ORIGIN}/*` });
    this.#tabId = tab?.id;
    return this.#tabId !== undefined;
  }

  get tabId(): number | undefined {
    return this.#tabId;
  }

  /** Talk to another ChatGPT tab from now on (the user clicked the Echoes button there). */
  bindTab(tabId: number): void {
    if (tabId === this.#tabId) return;
    this.#tabId = tabId;
    this.link.reconnect(); // requests after the ones in flight go to the new tab
  }

  /** What the bound ChatGPT tab shows now. */
  async context(): Promise<TabContext | undefined> {
    if (this.#tabId === undefined) return undefined;
    return tabContext(await chrome.tabs.get(this.#tabId).catch(() => ({})));
  }

  /**
   * Follow the bound tab: `fn` runs whenever its address or title changes (ChatGPT changes both without reloading),
   * when the Echoes button binds another tab, and when the bound tab closes (with another ChatGPT tab, if any).
   */
  watchContext(fn: (ctx: TabContext | undefined) => void): () => void {
    const refresh = () => void this.context().then(fn);
    const onUpdated = (id: number, change: { url?: string; title?: string; status?: string }) => {
      if (id === this.#tabId && (change.url !== undefined || change.title !== undefined || change.status === 'complete')) refresh();
    };
    const onRemoved = (id: number) => {
      if (id === this.#tabId) void this.findTab().then(refresh);
    };
    const onMessage = (m: unknown) => {
      if (typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'echoes:bind' && typeof (m as { tabId?: unknown }).tabId === 'number') {
        this.bindTab((m as { tabId: number }).tabId);
        refresh();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.runtime.onMessage.addListener(onMessage);
    void this.findTab().then(refresh);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }

  onQueueEvent(fn: (e: SchedulerEvent) => void): () => void {
    return this.scheduler.subscribe(fn);
  }

  async loadSettings(): Promise<PageSettings> {
    const got = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<PageSettings> | undefined;
    const base = ExportSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...got });
    const days = typeof got?.recheckDays === 'number' && got.recheckDays >= 0 ? got.recheckDays : DEFAULT_PAGE_SETTINGS.recheckDays;
    return { ...(base.success ? base.data : DEFAULT_SETTINGS), recheckDays: days };
  }

  saveSettings(s: PageSettings): Promise<void> {
    return chrome.storage.local.set({ [SETTINGS_KEY]: s });
  }

  selfTest(chatId?: string): Promise<SelfTestResult> {
    return selfTest(this.client, () => this.link.learned(), chatId);
  }

  /** Chats outside Projects first, then each Project. */
  async listGroups(): Promise<ChatGroup[]> {
    const chats = await this.client.listChats();
    const projects = await this.client.listProjects();
    const inProjects = new Set(projects.flatMap((p) => p.chats.map((c) => c.id)));
    return [
      { name: 'Chats', chats: chats.filter((c) => !inProjects.has(c.id)) },
      ...projects.map((p) => ({ projectId: p.id, name: p.name || 'Untitled Project', chats: p.chats })),
    ];
  }

  /** Ask for a folder; undefined when the browser lacks the API or the user cancels. */
  async pickFolder(): Promise<OutputTarget | undefined> {
    if (!window.showDirectoryPicker) return undefined;
    try {
      const dir = await window.showDirectoryPicker({ id: 'echoes-export', mode: 'readwrite' });
      return { kind: 'folder', sink: new FolderSink(dir), name: dir.name };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return undefined;
      throw e;
    }
  }

  /** The fallback: a zip streamed to a file the user names, or (without that API) downloaded at the end. */
  async zipTarget(): Promise<OutputTarget | undefined> {
    const name = `Echoes export ${new Date().toISOString().slice(0, 10)}.zip`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }] });
        return { kind: 'zip', sink: new ZipSink(await handle.createWritable(), new Date()), name };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return undefined;
        throw e;
      }
    }
    const chunks: Uint8Array[] = [];
    const target = new WritableStream<Uint8Array>({
      write: (c) => void chunks.push(c),
      close: () => download(name, new Blob(chunks as BlobPart[], { type: 'application/zip' })),
    });
    return { kind: 'zip', sink: new ZipSink(target, new Date()), name };
  }

  async exportAll(chats: ChatListItem[], settings: PageSettings, target: OutputTarget, opts: { reexportAll: boolean }, onProgress: (job: ExportJob) => void): Promise<ExportReport> {
    const jobId = `bulk-${Date.now()}`;
    const plan: { reexportAll: boolean; recheckBefore?: string } = { reexportAll: opts.reexportAll };
    if (settings.recheckDays > 0) plan.recheckBefore = new Date(Date.now() - settings.recheckDays * 86_400_000).toISOString();
    const release = await this.#keepAwake();
    try {
      return await exportChats(chats, toExportSettings(settings), jobId, this.#runOptions(target.sink, onProgress), plan);
    } finally {
      await release();
      await target.sink.close();
    }
  }

  async resume(jobId: string, target: OutputTarget, onProgress: (job: ExportJob) => void): Promise<ExportReport> {
    const release = await this.#keepAwake();
    try {
      return await resumeExport(jobId, this.#runOptions(target.sink, onProgress));
    } finally {
      await release();
      await target.sink.close();
    }
  }

  /** Keep Chrome from unloading the ChatGPT tab or this one while a bulk export runs. */
  async #keepAwake(): Promise<() => Promise<void>> {
    const own = await chrome.tabs.getCurrent().catch(() => undefined);
    return keepTabsAwake(chrome.tabs, [this.#tabId, own?.id]);
  }

  /** One chat, straight to a download (a zip when it has files). */
  async exportOne(chatId: string, settings: PageSettings): Promise<ExportReport> {
    const sink = new DownloadSink(async (name, blob) => download(name, blob), new Date());
    const report = await exportChats([{ id: chatId, title: '', updatedAt: '' }], toExportSettings(settings), `one-${Date.now()}`, {
      ...this.#runOptions(sink, () => undefined),
      store: new MemoryStore(), // a one-off download is not resumable
    });
    await sink.close();
    return report;
  }

  /**
   * One chat as a PDF, through the browser's print dialog ("Save as PDF"): vector text, the chosen theme, images
   * embedded. Returns warnings (files that could not be embedded).
   */
  async printChat(chatId: string, settings: PageSettings): Promise<string[]> {
    const page = await printableChat(chatId, toExportSettings(settings), { source: this.client, lineage: (id) => lineageFor(this.store, id) });
    await printHtml(page.html);
    return page.warnings;
  }

  /** Fetch one chat for the turn picker. */
  loadChat(chatId: string): Promise<{ conversation: Conversation; warnings: string[] }> {
    return loadChat(chatId, { source: this.client, lineage: (id) => lineageFor(this.store, id) });
  }

  /** The picked turns as a download (a zip when they have files). Returns warnings. */
  async exportSelection(conversation: Conversation, settings: PageSettings, selection: TurnSelection): Promise<string[]> {
    const sink = new DownloadSink(async (name, blob) => download(name, blob), new Date());
    const warnings = await exportSelection(conversation, toExportSettings(settings), selection, { source: this.client, sink });
    await sink.close();
    return warnings;
  }

  /** The picked turns through the print dialog. Returns warnings. */
  async printSelection(conversation: Conversation, settings: PageSettings, selection: TurnSelection): Promise<string[]> {
    const page = await printableConversation(conversation, toExportSettings(settings), this.client, selection);
    await printHtml(page.html);
    return page.warnings;
  }

  async loadPresets(): Promise<SavedPreset[]> {
    const got = (await chrome.storage.local.get(PRESETS_KEY))[PRESETS_KEY];
    return Array.isArray(got) ? (got as SavedPreset[]).filter((p) => typeof p?.name === 'string' && typeof p.turns === 'object') : [];
  }

  savePresets(presets: SavedPreset[]): Promise<void> {
    return chrome.storage.local.set({ [PRESETS_KEY]: presets });
  }

  async unfinishedJobs(): Promise<ExportJob[]> {
    const out: ExportJob[] = [];
    for (const id of await this.checkpoints.list()) {
      const job = await this.checkpoints.load(id).catch(() => undefined);
      if (job && !isJobFinished(job)) out.push(job);
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async cancel(job: ExportJob | undefined): Promise<void> {
    if (job) await cancelExportJob(job, this.checkpoints, new Date().toISOString());
  }

  async forget(jobId: string): Promise<void> {
    await this.checkpoints.remove(jobId);
  }

  #runOptions(sink: OutputSink, onProgress: (job: ExportJob) => void) {
    return {
      source: this.client,
      sink,
      store: this.store,
      now: () => new Date().toISOString(),
      lineage: (id: string) => lineageFor(this.store, id),
      onProgress,
    };
  }
}

function toExportSettings(s: PageSettings): ExportSettings {
  const { recheckDays: _days, ...rest } = s;
  return ExportSettingsSchema.parse(rest);
}

async function download(name: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Print an HTML document from a hidden frame, after its images have loaded. */
async function printHtml(html: string): Promise<void> {
  const frame = Object.assign(document.createElement('iframe'), { srcdoc: html, title: 'Print preview' });
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument!;
  for (const img of doc.images) img.loading = 'eager'; // lazy images in a hidden frame would never load
  await Promise.all([...doc.images].map((img) => img.decode().catch(() => undefined)));
  frame.contentWindow!.focus();
  frame.contentWindow!.print(); // blocks until the dialog closes
  frame.remove();
}
