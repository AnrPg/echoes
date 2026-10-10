import { SCHEMA_VERSION, parseConversation, type Conversation, type Node } from '@echoes/core';
import type { z } from 'zod';
import { toBlocks } from './blocks.ts';
import {
  RawConversationPageSchema,
  RawMessagesPageSchema,
  RawVersionsSchema,
  type RawConversationPage,
  type RawMessage,
  type RawMessagesPage,
} from './raw.ts';
import { ChatGptAdapterError, type AdapterIssue, type AdapterWarning } from './report.ts';

/**
 * Id of the hidden root node the adapter adds. ChatGPT's paged API does not return its own root (a hidden system
 * message), and the first question needs a parent so that an edit of it can be a sibling.
 */
export const ROOT_ID = 'echoes:root';

/** The raw responses for one chat, exactly as the host fetched them. The adapter never fetches anything itself. */
export interface ChatGptConversationCapture {
  /** Body of `GET /backend-api/conversations/:id?include_has_versions&num_turns` (the newest page). */
  conversation: unknown;
  /** Bodies of `GET /backend-api/conversations/:id/messages?before&…`, in the order fetched: each older than the last. */
  olderPages?: readonly unknown[];
  /** Bodies of `GET /backend-api/conversations/:id/versions?message_id=…`, keyed by that `message_id`. */
  versions?: Readonly<Record<string, unknown>>;
}

export interface ParseOptions {
  /** Link back to the chat. Defaults to `https://chatgpt.com/c/<id>`. */
  sourceUrl?: string;
}

export interface ChatGptParseResult {
  /** The normalized tree, already checked by `parseConversation` from `@echoes/core`. */
  conversation: Conversation;
  /** Everything the adapter handled but a person should know about. Nothing listed here was dropped silently. */
  warnings: AdapterWarning[];
  /**
   * Set when the chat was made with "Branch in new chat". The API names the source chat but not the fork message,
   * so this is not a full `LineageRef`; the branch monitor supplies the fork node.
   */
  branchedFrom?: { conversationId: string; title?: string };
}

/**
 * Turn the raw responses of one ChatGPT chat into an Echoes conversation tree.
 *
 * How the tree is built (Phase 0 findings):
 * - The pages hold the active path as a flat list, oldest page last in `olderPages`. Each message's parent is the
 *   message before it on that path; the first one hangs under {@link ROOT_ID}. `parent_id` is only cross-checked,
 *   because it often points at hidden messages the API leaves out.
 * - Each versions response adds the other versions of one turn. A version's messages that are already on the path
 *   (the shared question of a regenerated answer) are reused; its new messages chain under the last shared one, or
 *   under the anchor's parent when nothing is shared (an edited question). Siblings are ordered by creation time, so
 *   the original comes first, as in the web app's "1/2".
 * - A version on an earlier turn has later turns the API did not return; its leaf is marked
 *   `notFetched: 'later-messages'`. If the oldest page still has older pages, the root is marked `'earlier-messages'`.
 *
 * Throws {@link ChatGptAdapterError} when a response lacks a field the adapter relies on. Content it cannot map
 * becomes an `unknown` block plus a warning instead.
 *
 * @example
 * ```ts
 * const { conversation, warnings } = parseChatGptConversation({
 *   conversation: newestPageJson,
 *   olderPages: [olderPageJson],
 *   versions: { [messageId]: versionsJson },
 * });
 * ```
 */
export function parseChatGptConversation(capture: ChatGptConversationCapture, options: ParseOptions = {}): ChatGptParseResult {
  const issues: AdapterIssue[] = [];
  const head = check(RawConversationPageSchema, capture.conversation, ['conversation'], issues);
  const older = (capture.olderPages ?? []).map((p, i) => check(RawMessagesPageSchema, p, ['olderPages', i], issues));
  const versions = Object.entries(capture.versions ?? {}).map(
    ([id, v]) => [id, check(RawVersionsSchema, v, ['versions', id], issues)] as const,
  );
  if (!head || issues.length) throw new ChatGptAdapterError(issues);

  const warnings: AdapterWarning[] = [];
  const warn = (w: AdapterWarning) => warnings.push(w);
  const pages: (RawMessagesPage | RawConversationPage)[] = [...(older as RawMessagesPage[])].reverse();
  pages.push(head);

  // Active path, oldest first.
  const nodes = new Map<string, Node>();
  const root: Node = { id: ROOT_ID, parentId: null, childIds: [], role: 'system', blocks: [], hidden: true };
  nodes.set(ROOT_ID, root);
  const path: string[] = [];
  let prev = root;
  let prevTime: number | undefined;
  for (const [p, page] of pages.entries()) {
    const first = page.messages[0]?.create_time;
    if (p > 0 && prevTime != null && first != null && first < prevTime) {
      warn({ code: 'page-order', message: `page ${p} starts before the end of the page before it` });
    }
    for (const msg of page.messages) {
      if (nodes.has(msg.id)) {
        warn({ code: 'duplicate-message', messageId: msg.id, message: `message ${msg.id} appears twice on the path` });
        continue;
      }
      const parentId = msg.metadata?.parent_id;
      if (parentId && parentId !== prev.id && nodes.has(parentId)) {
        warn({ code: 'parent-mismatch', messageId: msg.id, message: `parent_id is ${parentId}, but the path has ${prev.id} before it` });
      }
      prev = attach(nodes, toNode(msg, prev.id, warn));
      path.push(msg.id);
    }
    prevTime = page.messages.at(-1)?.create_time ?? prevTime;
  }

  const leafId = path.at(-1) ?? ROOT_ID;
  if (path.length && head.current_node !== leafId) {
    throw new ChatGptAdapterError([
      { path: ['conversation', 'current_node'], message: `"${head.current_node}" is not the last message of the newest page ("${leafId}")` },
    ]);
  }
  if (pages[0]?.page_info.has_previous_page) {
    root.notFetched = 'earlier-messages';
    warn({ code: 'earlier-messages-not-fetched', message: 'the oldest page given still has older pages; history before it is missing' });
  }

  // Other versions.
  const onPath = new Set(path);
  const questionAt = (end: number) => {
    for (let i = end; i >= 0; i--) if (nodes.get(path[i]!)!.role === 'user') return path[i];
    return undefined;
  };
  const lastQuestion = questionAt(path.length - 1);
  for (const [anchorId, inner] of versions) {
    const anchor = onPath.has(anchorId) ? nodes.get(anchorId) : undefined;
    if (!anchor) {
      warn({ code: 'versions-anchor-missing', messageId: anchorId, message: `versions were given for ${anchorId}, which is not on the fetched path` });
      continue;
    }
    const anchorQuestion = questionAt(path.indexOf(anchorId));
    const laterTurnsExist = anchorQuestion !== lastQuestion;
    for (const version of inner ?? []) {
      let parentId = anchor.parentId ?? ROOT_ID;
      let added: Node | undefined;
      for (const msg of version) {
        if (nodes.has(msg.id)) {
          if (!added) parentId = msg.id;
          else warn({ code: 'version-rejoins-path', messageId: msg.id, message: `version of ${anchorId} lists known message ${msg.id} after new ones` });
          continue;
        }
        added = attach(nodes, toNode(msg, added?.id ?? parentId, warn));
      }
      if (added && laterTurnsExist) {
        added.notFetched = 'later-messages';
        warn({ code: 'later-messages-not-fetched', messageId: added.id, message: `the turns after this version of ${anchorId} were not loaded` });
      }
    }
  }
  for (const node of nodes.values()) if (node.childIds.length > 1) sortByTime(node, nodes);

  const conversation: Conversation = {
    schemaVersion: SCHEMA_VERSION,
    id: head.conversation_id,
    title: head.title ?? '',
    createdAt: iso(head.create_time),
    updatedAt: iso(head.update_time),
    sourceUrl: options.sourceUrl ?? `https://chatgpt.com/c/${head.conversation_id}`,
    rootId: ROOT_ID,
    activeLeafId: leafId,
    nodes: Object.fromEntries(nodes),
  };
  if (head.gizmo_type === 'snorlax' && head.gizmo_id) conversation.projectId = head.gizmo_id;
  if (head.default_model_slug) conversation.model = head.default_model_slug;

  const result: ChatGptParseResult = { conversation: parseConversation(conversation), warnings };
  const branch = pages.flatMap((p) => p.messages).find((m) => m.metadata?.branching_from_conversation_id)?.metadata;
  if (branch?.branching_from_conversation_id) {
    result.branchedFrom = { conversationId: branch.branching_from_conversation_id };
    if (branch.branching_from_conversation_title) result.branchedFrom.title = branch.branching_from_conversation_title;
  }
  return result;
}

function check<S extends z.ZodType>(schema: S, input: unknown, base: (string | number)[], issues: AdapterIssue[]): z.infer<S> | undefined {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  for (const i of r.error.issues) issues.push({ path: [...base, ...i.path.map((k) => (typeof k === 'symbol' ? String(k) : k))], message: i.message });
  return undefined;
}

function toNode(msg: RawMessage, parentId: string, warn: (w: AdapterWarning) => void): Node {
  const node: Node = {
    id: msg.id,
    parentId,
    childIds: [],
    role: msg.author.role,
    blocks: toBlocks(msg, warn),
    hidden: msg.weight === 0 || msg.metadata?.is_visually_hidden_from_conversation === true,
  };
  if (msg.create_time != null) node.createdAt = iso(msg.create_time);
  return node;
}

function attach(nodes: Map<string, Node>, node: Node): Node {
  nodes.set(node.id, node);
  nodes.get(node.parentId!)!.childIds.push(node.id);
  return node;
}

/** Stable sort by creation time; children without a time keep their place after the timed ones. */
function sortByTime(node: Node, nodes: Map<string, Node>): void {
  const time = (id: string) => nodes.get(id)!.createdAt ?? '￿';
  node.childIds = node.childIds
    .map((id, i) => ({ id, i, t: time(id) }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i))
    .map((x) => x.id);
}

/** ChatGPT times are Unix seconds with a fraction. */
function iso(seconds: number): string {
  return new Date(Math.round(seconds * 1000)).toISOString();
}
