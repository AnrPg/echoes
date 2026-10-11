import { z } from 'zod';
import { ChatGptAdapterError, type AdapterIssue } from './report.ts';

/**
 * Parsers for the ChatGPT list, branch and file responses a bulk export needs, as observed in the Phase 0 captures
 * (`docs/phase-0.md`, Q1 to Q4). Like the conversation parser, these only read responses the host already fetched.
 *
 * @packageDocumentation
 */

const nullish = <T extends z.ZodType>(t: T) => t.nullable().optional();

/** List endpoints send times as date strings; conversation pages send Unix seconds. Both are accepted. */
const RawTimeSchema = z.union([z.string(), z.number()]);

/** One chat in a list response. The list never includes messages (`mapping: null`) or the current node. */
export const RawChatListItemSchema = z.looseObject({
  id: z.string().min(1),
  title: nullish(z.string()),
  create_time: nullish(RawTimeSchema),
  update_time: RawTimeSchema,
  /** The Project (or GPT) the chat belongs to. */
  gizmo_id: nullish(z.string()),
  is_archived: nullish(z.boolean()),
});

/** `GET /backend-api/conversations?offset&limit&order&…`: offset pagination. */
export const RawChatListPageSchema = z.looseObject({
  items: z.array(RawChatListItemSchema),
  total: nullish(z.number().int()),
  limit: nullish(z.number().int()),
  offset: nullish(z.number().int()),
});

/** `GET /backend-api/gizmos/:id/conversations?cursor&limit&owned_only`: cursor pagination. */
export const RawProjectChatsPageSchema = z.looseObject({
  items: z.array(RawChatListItemSchema),
  cursor: nullish(z.string()),
});

/** `GET /backend-api/gizmos/snorlax/sidebar?…`: the Projects, each with the first page of its chats. */
export const RawProjectSidebarSchema = z.looseObject({
  cursor: nullish(z.string()),
  items: z.array(
    z.looseObject({
      gizmo: z.looseObject({
        gizmo: z.looseObject({
          id: z.string().min(1),
          display: nullish(z.looseObject({ name: nullish(z.string()) })),
        }),
      }),
      conversations: nullish(RawProjectChatsPageSchema),
    }),
  ),
});

/** `POST /backend-api/conversation/new_branch` request body. */
export const RawNewBranchRequestSchema = z.looseObject({
  conversation_id: z.string().min(1),
  message_id: z.string().min(1),
});

/** `POST /backend-api/conversation/new_branch` response: the new chat, as a full tree. */
export const RawNewBranchResponseSchema = z.looseObject({
  conversation: z.looseObject({
    conversation_id: z.string().min(1),
    current_node: nullish(z.string()),
    create_time: nullish(z.number()),
  }),
});

/** `GET /backend-api/files/download/:id`. */
export const RawFileDownloadSchema = z.looseObject({
  status: z.string(),
  download_url: nullish(z.string()),
  file_name: nullish(z.string()),
  file_size_bytes: nullish(z.number()),
  mime_type: nullish(z.string()),
});

/** One chat as a list reports it. Matches `ChatSummary` in `@echoes/core`, plus where it lives. */
export interface ChatListItem {
  id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  /** Set for chats inside a Project. */
  projectId?: string;
  archived?: boolean;
}

export interface ChatListPage {
  chats: ChatListItem[];
  /** Offset for the next page, or null when this was the last one. */
  nextOffset: number | null;
  total?: number;
}

export interface ProjectChatsPage {
  chats: ChatListItem[];
  /** Pass back as `cursor` for the next page. Null on the last page (inferred from the sidebar's `null` cursors). */
  nextCursor: string | null;
}

export interface Project {
  id: string;
  name: string;
  /** The first page of the Project's chats, as the sidebar returned it. */
  firstPage: ProjectChatsPage;
}

export interface ProjectSidebarPage {
  projects: Project[];
  nextCursor: string | null;
}

/** A "Branch in new chat", as recorded by the branch monitor. Recorded evidence: the request names the fork. */
export interface NewBranch {
  parentConversationId: string;
  forkMessageId: string;
  childConversationId: string;
}

export type FileDownload =
  | { ok: true; url: string; fileName?: string; sizeBytes?: number; mime?: string }
  | { ok: false; status: string };

function parse<S extends z.ZodType>(schema: S, input: unknown, base: string): z.infer<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const issues: AdapterIssue[] = r.error.issues.map((i) => ({
    path: [base, ...i.path.map((k) => (typeof k === 'symbol' ? String(k) : k))],
    message: i.message,
  }));
  throw new ChatGptAdapterError(issues);
}

function iso(time: string | number, path: (string | number)[]): string {
  const ms = typeof time === 'number' ? Math.round(time * 1000) : Date.parse(time);
  if (!Number.isFinite(ms)) throw new ChatGptAdapterError([{ path, message: `not a date: ${JSON.stringify(time)}` }]);
  return new Date(ms).toISOString();
}

function item(raw: z.infer<typeof RawChatListItemSchema>, path: (string | number)[]): ChatListItem {
  const chat: ChatListItem = { id: raw.id, title: raw.title ?? '', updatedAt: iso(raw.update_time, [...path, 'update_time']) };
  if (raw.create_time != null) chat.createdAt = iso(raw.create_time, [...path, 'create_time']);
  if (raw.gizmo_id) chat.projectId = raw.gizmo_id;
  if (raw.is_archived != null) chat.archived = raw.is_archived;
  return chat;
}

/**
 * Parse one page of the main chat list. The next offset is `offset + items.length` while that is below `total`;
 * without a `total`, a short or empty page ends the list.
 *
 * @example
 * ```ts
 * for (let offset = 0; offset !== null; ) {
 *   const page = parseChatListPage(await fetchList(offset)); // the host's request, through the scheduler
 *   chats.push(...page.chats);
 *   offset = page.nextOffset;
 * }
 * ```
 */
export function parseChatListPage(input: unknown): ChatListPage {
  const raw = parse(RawChatListPageSchema, input, 'chatList');
  const chats = raw.items.map((c, i) => item(c, ['chatList', 'items', i]));
  const offset = raw.offset ?? 0;
  const next = offset + raw.items.length;
  const more = raw.total != null ? next < raw.total : raw.limit != null && raw.items.length >= raw.limit;
  const page: ChatListPage = { chats, nextOffset: more && raw.items.length > 0 ? next : null };
  if (raw.total != null) page.total = raw.total;
  return page;
}

/** Parse one page of a Project's chats. */
export function parseProjectChatsPage(input: unknown): ProjectChatsPage {
  const raw = parse(RawProjectChatsPageSchema, input, 'projectChats');
  return { chats: raw.items.map((c, i) => item(c, ['projectChats', 'items', i])), nextCursor: raw.cursor || null };
}

/** Parse one page of the Projects sidebar. */
export function parseProjectSidebar(input: unknown): ProjectSidebarPage {
  const raw = parse(RawProjectSidebarSchema, input, 'projectSidebar');
  return {
    projects: raw.items.map((p, i) => ({
      id: p.gizmo.gizmo.id,
      name: p.gizmo.gizmo.display?.name ?? '',
      firstPage: p.conversations
        ? {
            chats: p.conversations.items.map((c, j) => item(c, ['projectSidebar', 'items', i, 'conversations', 'items', j])),
            nextCursor: p.conversations.cursor || null,
          }
        : { chats: [], nextCursor: null },
    })),
    nextCursor: raw.cursor || null,
  };
}

/** Read a "Branch in new chat" from the request and response bodies the branch monitor saw. */
export function parseNewBranch(requestBody: unknown, responseBody: unknown): NewBranch {
  const req = parse(RawNewBranchRequestSchema, requestBody, 'newBranchRequest');
  const res = parse(RawNewBranchResponseSchema, responseBody, 'newBranchResponse');
  return { parentConversationId: req.conversation_id, forkMessageId: req.message_id, childConversationId: res.conversation.conversation_id };
}

/**
 * Parse a file download response. Only `status: "success"` with a URL was observed; any other status is returned
 * as not available so the export can report the file instead of failing.
 */
export function parseFileDownload(input: unknown): FileDownload {
  const raw = parse(RawFileDownloadSchema, input, 'fileDownload');
  if (raw.status !== 'success' || !raw.download_url) return { ok: false, status: raw.status };
  const out: FileDownload = { ok: true, url: raw.download_url };
  if (raw.file_name) out.fileName = raw.file_name;
  if (raw.file_size_bytes != null) out.sizeBytes = raw.file_size_bytes;
  if (raw.mime_type) out.mime = raw.mime_type;
  return out;
}
