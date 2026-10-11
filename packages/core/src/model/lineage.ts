import { z } from 'zod';
import { contentFingerprint } from '../output/manifest.ts';
import type { Conversation, LineageRef, Node } from './schema.ts';
import { activePath } from './tree.ts';
import { widgetText } from './widget.ts';

/**
 * Lineage inference (Build Plan §7): link a chat made with "Branch in new chat" to its source when the branch
 * monitor did not see it happen (mobile, another browser, before install). A branched chat starts with a copy of
 * the source's messages up to the fork, so the longest shared start says where it came from.
 *
 * Messages are compared by role and content, never by id alone: whether the copy keeps the source's message ids is
 * not known (Phase 0 saw only shapes; the copy keeps the source's `create_time` values). Matching ids or times make a
 * match strong; content alone makes it weak.
 *
 * Chats are compared through a {@link ChatSkeleton}: a small, storable summary, so a host can keep one per exported
 * chat and infer links later without keeping whole chats.
 *
 * @packageDocumentation
 */

export const SKELETON_VERSION = 1;

const SkeletonNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  /** Role and content fingerprint; absent for nodes the chat view hides (they are skipped when matching). */
  sig: z.string().optional(),
  createdAt: z.string().optional(),
});

export const ChatSkeletonSchema = z.object({
  version: z.literal(SKELETON_VERSION),
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  rootId: z.string(),
  activeLeafId: z.string(),
  nodes: z.record(z.string(), SkeletonNodeSchema),
});

/** A chat's tree with a fingerprint per visible message: enough to compare chats, small enough to store. */
export type ChatSkeleton = z.infer<typeof ChatSkeletonSchema>;

/** The skeleton of a chat. */
export function chatSkeleton(c: Conversation): ChatSkeleton {
  const nodes: ChatSkeleton['nodes'] = {};
  for (const n of Object.values(c.nodes)) {
    const s: ChatSkeleton['nodes'][string] = { id: n.id, parentId: n.parentId, childIds: [...n.childIds] };
    const sig = signature(n);
    if (sig) s.sig = sig;
    if (n.createdAt) s.createdAt = n.createdAt;
    nodes[n.id] = s;
  }
  return { version: SKELETON_VERSION, id: c.id, title: c.title, createdAt: c.createdAt, rootId: c.rootId, activeLeafId: c.activeLeafId, nodes };
}

/** Role plus a fingerprint of the visible content; undefined for hidden, system and empty messages. */
function signature(n: Node): string | undefined {
  if (n.hidden || (n.role !== 'user' && n.role !== 'assistant')) return undefined;
  const text = n.blocks
    .map((b) => {
      switch (b.kind) {
        case 'markdown':
        case 'code':
          return b.text;
        case 'canvas':
          return `${b.title}\n${b.text}`;
        case 'widget':
          return widgetText(b.view);
        case 'image':
        case 'attachment':
          return `[${b.kind}:${b.resource.name ?? ''}]`;
        default:
          return '';
      }
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? `${n.role}:${contentFingerprint(text)}` : undefined;
}

/** Where two chats stop sharing messages. */
export interface SharedHistory {
  /** Visible messages the child shares with the parent, from the start. */
  shared: number;
  /** Of those, how many also have the same id or the same creation time (a strong match). */
  strong: number;
  /** Last shared node in the parent. */
  parentNodeId: string;
  /** Last shared node in the child. */
  childNodeId: string;
  /** Visible messages on the child's active path. */
  childLength: number;
}

/**
 * How far the child's active path follows some path of the parent's tree, comparing visible messages only. The fork
 * may be on any version of the parent, not just its active one. `undefined` when the first message differs.
 */
export function sharedHistory(parent: ChatSkeleton, child: ChatSkeleton): SharedHistory | undefined {
  const childSeq = visiblePath(child);
  let frontier = visibleChildren(parent, parent.rootId);
  let shared = 0;
  let strong = 0;
  let parentNodeId: string | undefined;
  let childNodeId: string | undefined;
  for (const c of childSeq) {
    const candidates = frontier.filter((p) => p.sig === c.sig);
    if (!candidates.length) break;
    const isStrong = (p: ChatSkeleton['nodes'][string]) => p.id === c.id || (p.createdAt !== undefined && p.createdAt === c.createdAt);
    const pick = candidates.find(isStrong) ?? candidates[0]!;
    shared++;
    if (isStrong(pick)) strong++;
    parentNodeId = pick.id;
    childNodeId = c.id;
    frontier = visibleChildren(parent, pick.id);
  }
  if (!shared) return undefined;
  return { shared, strong, parentNodeId: parentNodeId!, childNodeId: childNodeId!, childLength: childSeq.length };
}

function visiblePath(s: ChatSkeleton): ChatSkeleton['nodes'][string][] {
  const path: ChatSkeleton['nodes'][string][] = [];
  for (let id: string | null = s.activeLeafId; id !== null; ) {
    const n: ChatSkeleton['nodes'][string] | undefined = s.nodes[id];
    if (!n) break;
    if (n.sig) path.push(n);
    id = n.parentId;
  }
  return path.reverse();
}

/** The nearest visible descendants of a node, looking through hidden ones. */
function visibleChildren(s: ChatSkeleton, id: string): ChatSkeleton['nodes'][string][] {
  const out: ChatSkeleton['nodes'][string][] = [];
  const stack = [...(s.nodes[id]?.childIds ?? [])].reverse();
  while (stack.length) {
    const n = s.nodes[stack.pop()!];
    if (!n) continue;
    if (n.sig) out.push(n);
    else stack.push(...[...n.childIds].reverse());
  }
  return out;
}

export interface InferOptions {
  /** ISO time written as `detectedAt`. */
  now: string;
  /** Fewest shared visible messages for a link. Default 2 (one question and its answer). */
  minShared?: number;
}

/**
 * The most likely source of `child` among `candidates`, as an `inferred` link, or `undefined` when none shares at
 * least `minShared` messages. Only chats created before the child qualify. Confidence, from the shared start of `m`
 * messages:
 *
 * - every shared message also matches by id or time: `min(0.95, 0.6 + 0.1·m)`;
 * - otherwise: `min(0.7, 0.3 + 0.1·m)`;
 * - halved when another candidate shares just as much (the source is ambiguous; the older chat is chosen).
 *
 * @example
 * ```ts
 * const link = inferLineage(chatSkeleton(child), skeletons, { now: new Date().toISOString() });
 * if (link) child.lineage = link; // evidence 'inferred'; renderers say so
 * ```
 */
export function inferLineage(child: ChatSkeleton, candidates: Iterable<ChatSkeleton>, options: InferOptions): LineageRef | undefined {
  const min = options.minShared ?? 2;
  const matches: { parent: ChatSkeleton; h: SharedHistory }[] = [];
  for (const parent of candidates) {
    if (parent.id === child.id || !(parent.createdAt < child.createdAt)) continue;
    const h = sharedHistory(parent, child);
    if (h && h.shared >= min) matches.push({ parent, h });
  }
  if (!matches.length) return undefined;
  const best = Math.max(...matches.map((m) => m.h.shared));
  const top = matches.filter((m) => m.h.shared === best).sort((a, b) => (a.parent.createdAt < b.parent.createdAt ? -1 : 1));
  const { parent, h } = top[0]!;
  let confidence = h.strong === h.shared ? Math.min(0.95, 0.6 + 0.1 * h.shared) : Math.min(0.7, 0.3 + 0.1 * h.shared);
  if (top.length > 1) confidence /= 2;
  return {
    parentConversationId: parent.id,
    forkNodeId: h.parentNodeId,
    childConversationId: child.id,
    detectedAt: options.now,
    evidence: 'inferred',
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * A link from the chat's own metadata: ChatGPT stores the source chat's id on a branched chat's messages, but not
 * the fork message, so the fork comes from the shared start with that source. Evidence `api-metadata`, confidence 1
 * for the source; `undefined` when the two share nothing (the source changed beyond recognition).
 */
export function lineageFromMetadata(child: ChatSkeleton, parent: ChatSkeleton, now: string): LineageRef | undefined {
  const h = sharedHistory(parent, child);
  if (!h) return undefined;
  return { parentConversationId: parent.id, forkNodeId: h.parentNodeId, childConversationId: child.id, detectedAt: now, evidence: 'api-metadata', confidence: 1 };
}
