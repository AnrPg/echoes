import type { Conversation, Node } from './schema.ts';

/**
 * Tree functions over a validated {@link Conversation}. All are pure and deterministic: child order is the order of
 * `childIds`, never re-sorted. They expect a conversation that passed {@link parseConversation}; on broken links
 * they throw {@link TreeError} rather than return partial results.
 *
 * Terms: a **path** is a list of node ids from the root down. A **traversal** is a root-to-leaf path; a chat has
 * exactly one traversal per leaf. A **version group** is the set of siblings under one parent (ChatGPT's "2/3"
 * arrows); choosing a version means choosing its whole subtree.
 */

export class TreeError extends Error {
  override readonly name = 'TreeError';
}

/** Look up a node, throwing {@link TreeError} if it does not exist. */
export function getNode(c: Conversation, id: string): Node {
  const node = c.nodes[id];
  if (!node) throw new TreeError(`node "${id}" does not exist in conversation "${c.id}"`);
  return node;
}

/**
 * Ids from the root down to `nodeId`, inclusive.
 *
 * @example
 * ```ts
 * pathTo(conversation, 'a2'); // ['root', 'u1', 'a2']
 * ```
 */
export function pathTo(c: Conversation, nodeId: string): string[] {
  const path: string[] = [];
  const limit = Object.keys(c.nodes).length;
  let id: string | null = nodeId;
  while (id !== null) {
    if (path.length > limit) throw new TreeError(`cycle above node "${nodeId}"`);
    path.push(id);
    id = getNode(c, id).parentId;
  }
  if (path[path.length - 1] !== c.rootId) throw new TreeError(`node "${nodeId}" is not under the root`);
  return path.reverse();
}

/**
 * The branch the user currently sees: root to `activeLeafId`.
 *
 * @example
 * ```ts
 * activePath(conversation).map((id) => conversation.nodes[id]!.role);
 * ```
 */
export function activePath(c: Conversation): string[] {
  return pathTo(c, c.activeLeafId);
}

/** Every node id under `nodeId` (inclusive) in depth-first pre-order following `childIds`. */
export function subtree(c: Conversation, nodeId: string): string[] {
  const out: string[] = [];
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const { childIds } = getNode(c, id);
    for (let i = childIds.length - 1; i >= 0; i--) stack.push(childIds[i]!);
  }
  return out;
}

/** Leaf ids (nodes without children) under `nodeId`, default the root, in depth-first order. */
export function leaves(c: Conversation, nodeId: string = c.rootId): string[] {
  return subtree(c, nodeId).filter((id) => c.nodes[id]!.childIds.length === 0);
}

/** One root-to-leaf path. */
export interface Traversal {
  leafId: string;
  /** Root first. */
  nodeIds: string[];
  /** True for the path ending at `activeLeafId`. */
  active: boolean;
}

/**
 * All root-to-leaf paths, in depth-first leaf order. The count equals the number of leaves, so it grows linearly
 * with edits and regenerations, not exponentially.
 *
 * @example
 * ```ts
 * traversals(conversation).filter((t) => !t.active).length; // how many alternative branches exist
 * ```
 */
export function traversals(c: Conversation): Traversal[] {
  return leaves(c).map((leafId) => ({ leafId, nodeIds: pathTo(c, leafId), active: leafId === c.activeLeafId }));
}

/** Siblings under one parent: the versions of an edited question or a regenerated answer. */
export interface VersionGroup {
  parentId: string;
  /** Versions in provider order, i.e. the order of the "1/3, 2/3, 3/3" arrows. */
  nodeIds: string[];
  /** Index into `nodeIds` of the version on the active path, or -1 if the active path does not pass here. */
  activeIndex: number;
}

/**
 * Every parent with more than one child, in depth-first order.
 *
 * @example
 * ```ts
 * versionGroups(conversation).map((g) => `${g.activeIndex + 1}/${g.nodeIds.length}`); // ['2/3']
 * ```
 */
export function versionGroups(c: Conversation): VersionGroup[] {
  const onActive = new Set(activePath(c));
  const groups: VersionGroup[] = [];
  for (const id of subtree(c, c.rootId)) {
    const { childIds } = c.nodes[id]!;
    if (childIds.length > 1) {
      groups.push({ parentId: id, nodeIds: [...childIds], activeIndex: childIds.findIndex((x) => onActive.has(x)) });
    }
  }
  return groups;
}

/**
 * The full path through `nodeId`: root to `nodeId`, then down to a leaf. Below `nodeId` it follows the active path
 * where that passes, and otherwise the last (most recent) child. This is what "show version 2/3 of this answer"
 * displays: the chosen version plus its own downstream turns.
 *
 * @example
 * ```ts
 * const [first] = versionGroups(conversation);
 * pathThrough(conversation, first!.nodeIds[0]!); // the first version and the turns that followed it
 * ```
 */
export function pathThrough(c: Conversation, nodeId: string): string[] {
  const onActive = new Set(activePath(c));
  const path = pathTo(c, nodeId);
  let node = getNode(c, nodeId);
  while (node.childIds.length > 0) {
    const next = node.childIds.find((x) => onActive.has(x)) ?? node.childIds[node.childIds.length - 1]!;
    path.push(next);
    node = getNode(c, next);
  }
  return path;
}

/** Resolve ids to nodes, preserving order. */
export function nodesOf(c: Conversation, ids: readonly string[]): Node[] {
  return ids.map((id) => getNode(c, id));
}
