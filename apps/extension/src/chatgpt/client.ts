// Reads ChatGPT data through the page bridge, every request through the one core Scheduler. Parsing stays in the
// adapter package; this module only decides which requests to make, in which order.

import {
  pageFollowUps,
  parseChatListPage,
  parseFileDownload,
  parseProjectChatsPage,
  parseProjectSidebar,
  type ChatGptConversationCapture,
  type ChatListItem,
  type Project,
} from '@echoes/adapter-chatgpt-api';
import type { Scheduler, TransportResponse } from '@echoes/core';
import { fromBase64 } from '../bridge/base64';
import type { LearnedState } from '../bridge/protocol';
import { buildUrl, chatListUrls, type TemplateSource } from './urls';

/** What the bridge transport resolves with: enough for the scheduler, plus the body. */
export interface BridgeResponse extends TransportResponse {
  /** Text, or base64 for binary requests. */
  readonly body: string;
}

/** Thrown when a paged walk does not end (a repeated cursor), instead of looping forever. */
export class PagingError extends Error {
  override readonly name = 'PagingError';
}

export interface ChatGptClientOptions {
  origin: string;
  scheduler: Scheduler<BridgeResponse>;
  /** Reads what the bridge learned from the app's own requests. */
  learned: () => Promise<LearnedState>;
  /** Upper bound on pages for one walk. Default 2000. */
  maxPages?: number;
  /** Plain fetch for images ChatGPT found on the web. Default: the page's `fetch`. */
  fetchWeb?: typeof fetch;
}

/** The only host web images are downloaded from: ChatGPT's own copies of the images it found. */
const WEB_IMAGE_HOST = 'images.openai.com';

export type ProjectWithChats = Project & { chats: ChatListItem[] };

/** How far a chat-list walk has got: Projects whose chats are all listed, of how many, and chats found so far. */
export interface ListProgress {
  projectsDone: number;
  projects: number;
  chats: number;
}

export type DownloadedFile =
  | { ok: true; bytes: Uint8Array; fileName?: string; mime?: string }
  | { ok: false; reason: string };

export class ChatGptClient {
  readonly #o: Required<ChatGptClientOptions>;
  /** Endpoints fetched with an inferred (not learned) query, for the self-test report. */
  readonly inferred = new Set<string>();

  constructor(options: ChatGptClientOptions) {
    this.#o = { maxPages: 2000, fetchWeb: (...a) => fetch(...a), ...options };
  }

  async #json(url: string): Promise<unknown> {
    const res = await this.#o.scheduler.request({ url, method: 'GET' });
    try {
      return JSON.parse(res.body);
    } catch {
      throw new Error(`ChatGPT answered ${new URL(url).pathname} with something that is not JSON`);
    }
  }

  #note(kind: string, source: TemplateSource) {
    if (source === 'inferred') this.inferred.add(kind);
  }

  /** Every response a chat needs: the newest page, all older pages, and the other versions of each turn. */
  async fetchConversation(id: string): Promise<ChatGptConversationCapture> {
    const learned = await this.#o.learned();
    const head = buildUrl(this.#o.origin, learned, 'conversation', id);
    const conversation = await this.#json(head.url);
    const olderPages: unknown[] = [];
    const versioned = new Set(pageFollowUps(conversation).versionedMessageIds);
    const seen = new Set<string>();
    let next = pageFollowUps(conversation).olderCursor;
    while (next) {
      if (seen.has(next) || seen.size >= this.#o.maxPages) throw new PagingError(`older pages of ${id} do not end (cursor ${next} repeats)`);
      seen.add(next);
      const u = buildUrl(this.#o.origin, learned, 'messages', id, { before: next });
      this.#note('messages', u.source);
      const page = await this.#json(u.url);
      olderPages.push(page);
      const f = pageFollowUps(page);
      for (const m of f.versionedMessageIds) versioned.add(m);
      next = f.olderCursor;
    }
    const versions: Record<string, unknown> = {};
    for (const messageId of [...versioned].sort()) {
      const u = buildUrl(this.#o.origin, learned, 'versions', id, { message_id: messageId });
      this.#note('versions', u.source);
      versions[messageId] = await this.#json(u.url);
    }
    const capture: ChatGptConversationCapture = { conversation };
    if (olderPages.length) capture.olderPages = olderPages;
    if (Object.keys(versions).length) capture.versions = versions;
    return capture;
  }

  /** All chats outside Projects, newest first as ChatGPT lists them, deduplicated across the app's list variants. */
  async listChats(): Promise<ChatListItem[]> {
    const learned = await this.#o.learned();
    const variants = chatListUrls(this.#o.origin, learned, 0).length;
    const byId = new Map<string, ChatListItem>();
    for (let v = 0; v < variants; v++) {
      let offset: number | null = 0;
      for (let pages = 0; offset !== null; pages++) {
        if (pages >= this.#o.maxPages) throw new PagingError('the chat list does not end');
        const page = parseChatListPage(await this.#json(chatListUrls(this.#o.origin, learned, offset)[v]!));
        for (const c of page.chats) if (!byId.has(c.id)) byId.set(c.id, c);
        offset = page.nextOffset;
      }
    }
    return [...byId.values()];
  }

  /** The first page of each chat-list variant: a quick check that listing works. */
  async firstChats(): Promise<ChatListItem[]> {
    const learned = await this.#o.learned();
    const byId = new Map<string, ChatListItem>();
    for (const url of chatListUrls(this.#o.origin, learned, 0)) {
      for (const c of parseChatListPage(await this.#json(url)).chats) if (!byId.has(c.id)) byId.set(c.id, c);
    }
    return [...byId.values()];
  }

  /**
   * The first page of the Projects sidebar and, when a Project has more chats than that page holds, one more page of
   * its chats: enough to check both requests without listing everything.
   */
  async probeProjects(): Promise<{ projects: number; chatsPageTried: boolean }> {
    const learned = await this.#o.learned();
    const page = parseProjectSidebar(await this.#json(buildUrl(this.#o.origin, learned, 'projectSidebar', '', {}).url));
    const withMore = page.projects.find((p) => p.firstPage.nextCursor);
    if (withMore?.firstPage.nextCursor) {
      parseProjectChatsPage(await this.#json(buildUrl(this.#o.origin, learned, 'projectChats', withMore.id, { cursor: withMore.firstPage.nextCursor }).url));
    }
    return { projects: page.projects.length, chatsPageTried: withMore !== undefined };
  }

  /** The first Project in the sidebar list that `match` accepts (only the list is paged, not its chats). */
  async findProject(match: (p: Project) => boolean): Promise<Project | undefined> {
    const learned = await this.#o.learned();
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const set: Record<string, string> = cursor ? { cursor } : {};
      const page = parseProjectSidebar(await this.#json(buildUrl(this.#o.origin, learned, 'projectSidebar', '', set).url));
      const found = page.projects.find(match);
      if (found) return found;
      if (cursor) seen.add(cursor);
      cursor = page.nextCursor;
      if (cursor && (seen.has(cursor) || seen.size >= this.#o.maxPages)) throw new PagingError('the Project list does not end');
    } while (cursor);
    return undefined;
  }

  /**
   * All Projects, each with every one of its chats. `onProgress` hears after each request, so a long list never looks
   * stuck.
   */
  async listProjects(onProgress?: (p: ListProgress) => void): Promise<ProjectWithChats[]> {
    const learned = await this.#o.learned();
    const projects: Project[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const set: Record<string, string> = cursor ? { cursor } : {};
      const page = parseProjectSidebar(await this.#json(buildUrl(this.#o.origin, learned, 'projectSidebar', '', set).url));
      projects.push(...page.projects);
      if (cursor) seen.add(cursor);
      cursor = page.nextCursor;
      if (cursor && (seen.has(cursor) || seen.size >= this.#o.maxPages)) throw new PagingError('the Project list does not end');
      onProgress?.({ projectsDone: 0, projects: projects.length, chats: 0 });
    } while (cursor);

    const out: ProjectWithChats[] = [];
    let chats = 0;
    for (const p of projects) {
      out.push(await this.#withChats(learned, p, (n) => onProgress?.({ projectsDone: out.length, projects: projects.length, chats: chats + n })));
      chats += out.at(-1)!.chats.length;
      onProgress?.({ projectsDone: out.length, projects: projects.length, chats });
    }
    return out;
  }

  /** One Project (the first in the sidebar list that `match` accepts) with every one of its chats. */
  async projectWithChats(match: (p: Project) => boolean, onProgress?: (p: ListProgress) => void): Promise<ProjectWithChats | undefined> {
    const p = await this.findProject(match);
    if (!p) return undefined;
    const out = await this.#withChats(await this.#o.learned(), p, (n) => onProgress?.({ projectsDone: 0, projects: 1, chats: n }));
    onProgress?.({ projectsDone: 1, projects: 1, chats: out.chats.length });
    return out;
  }

  /**
   * Every chat of one Project. The sidebar carries only the first few chats of the Projects on its first page; Projects
   * on later pages come with none and no cursor (2026-10-11 capture), so their list starts from the Project's own first
   * page, as the app's Project page does.
   */
  async #withChats(learned: LearnedState, p: Project, onChats: (n: number) => void): Promise<ProjectWithChats> {
    const fromSidebar = p.firstPage.chats.length > 0 || p.firstPage.nextCursor !== null;
    const chats = [...p.firstPage.chats];
    let c = p.firstPage.nextCursor;
    if (!fromSidebar) {
      const page = parseProjectChatsPage(await this.#json(buildUrl(this.#o.origin, learned, 'projectChats', p.id, {}).url));
      chats.push(...page.chats);
      c = page.nextCursor;
      onChats(chats.length);
    }
    const cursors = new Set<string>();
    while (c) {
      if (cursors.has(c) || cursors.size >= this.#o.maxPages) throw new PagingError(`the chats of Project ${p.id} do not end`);
      cursors.add(c);
      const page = parseProjectChatsPage(await this.#json(buildUrl(this.#o.origin, learned, 'projectChats', p.id, { cursor: c }).url));
      chats.push(...page.chats);
      c = page.nextCursor;
      onChats(chats.length);
    }
    return { ...p, chats };
  }

  /**
   * An image ChatGPT found on the web, from its copy on images.openai.com: a plain GET from the extension, without
   * cookies, the ChatGPT token or a referrer. Any other host is refused without a request.
   */
  async downloadUrl(url: string): Promise<DownloadedFile> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, reason: 'not a URL' };
    }
    if (u.protocol !== 'https:' || u.hostname !== WEB_IMAGE_HOST) return { ok: false, reason: `Echoes only downloads web images from ${WEB_IMAGE_HOST}` };
    const res = await this.#o.fetchWeb(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) return { ok: false, reason: `${WEB_IMAGE_HOST} answered ${res.status}` };
    const file: DownloadedFile = { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim();
    if (mime) file.mime = mime;
    return file;
  }

  /** One file's bytes: `files/download/:id`, then its signed URL. A file ChatGPT no longer has is reported, not thrown. */
  async downloadFile(fileId: string): Promise<DownloadedFile> {
    const learned = await this.#o.learned();
    const u = buildUrl(this.#o.origin, learned, 'fileDownload', fileId);
    const info = parseFileDownload(await this.#json(u.url));
    if (!info.ok) return { ok: false, reason: `ChatGPT reports the file as "${info.status}"` };
    // The transport asks the bridge for base64 on `estuary/content` URLs.
    const res = await this.#o.scheduler.request({ url: new URL(info.url, this.#o.origin).href, method: 'GET' });
    const file: DownloadedFile = { ok: true, bytes: fromBase64(res.body) };
    if (info.fileName) file.fileName = info.fileName;
    const mime = info.mime ?? res.headers.get('content-type')?.split(';')[0]?.trim();
    if (mime) file.mime = mime;
    return file;
  }
}
