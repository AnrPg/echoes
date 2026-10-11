import type { Conversation, Node } from './schema.ts';
import { activePath, getNode, nodesOf, traversals, type Traversal } from './tree.ts';
import { buildTurns } from './turns.ts';
import { widgetText } from './widget.ts';

/**
 * Versions and traversals as the user picks them before an export (Build Plan §6). Choosing a version means
 * choosing its whole subtree: a traversal is kept only if every version it passes through is chosen.
 *
 * @packageDocumentation
 */

/** One point where a traversal takes a version: an edited question or a regenerated answer. */
export interface Fork {
  /** 1-based turn number along this traversal. */
  turn: number;
  kind: 'edited' | 'regenerated';
  /** 1-based version number, as in the web app's "2/3". */
  version: number;
  of: number;
  /** The version node taken here. */
  nodeId: string;
}

/** A traversal with a readable name, such as "Turn 5: question version 2 of 2 · Turn 9: answer version 3 of 3". */
export interface NamedTraversal extends Traversal {
  name: string;
  forks: Fork[];
}

/**
 * Every traversal with its forks and an automatic name. The name lists each fork along the path, in the words the
 * web app's "2/3" arrows stand for; a chat without versions has one traversal named "Only version". Order:
 * depth-first leaf order, as {@link traversals}.
 *
 * @example
 * ```ts
 * namedTraversals(conversation).map((t) => t.name);
 * // ['Turn 2: question version 1 of 2', 'Turn 2: question version 2 of 2']
 * ```
 */
export function namedTraversals(c: Conversation): NamedTraversal[] {
  return traversals(c).map((t) => {
    const forks = forksOf(c, t.nodeIds);
    const name = forks.length ? forks.map(forkName).join(' · ') : 'Only version';
    return { ...t, forks, name };
  });
}

/** One fork in words: "Turn 5: question version 2 of 2" (an edited question) or "Turn 6: answer version 1 of 3". */
export function forkName(f: Fork): string {
  return `Turn ${f.turn}: ${f.kind === 'edited' ? 'question' : 'answer'} version ${f.version} of ${f.of}`;
}

function forksOf(c: Conversation, nodeIds: readonly string[]): Fork[] {
  const turnOf = new Map<string, number>();
  for (const turn of buildTurns(nodesOf(c, nodeIds))) {
    for (const n of [turn.question, ...turn.responses]) if (n) turnOf.set(n.id, turn.index);
  }
  const forks: Fork[] = [];
  for (const id of nodeIds) {
    const node = getNode(c, id);
    const siblings = node.parentId === null ? [] : getNode(c, node.parentId).childIds;
    if (siblings.length < 2) continue;
    forks.push({
      turn: Math.max(1, turnOf.get(id) ?? 1),
      kind: node.role === 'user' ? 'edited' : 'regenerated',
      version: siblings.indexOf(id) + 1,
      of: siblings.length,
      nodeId: id,
    });
  }
  return forks;
}

/**
 * Which versions to export. `active`: only the branch the user sees. `all`: every traversal. `chosen`: the given
 * version nodes; a version left out drops its whole subtree. Versions of groups not listed in `chosen` count as
 * chosen, so a list only needs the groups the user changed.
 */
export type VersionSelection = { mode: 'active' } | { mode: 'all' } | { mode: 'chosen'; excluded: readonly string[] };

/**
 * The traversals a selection keeps, active one first when kept, then in depth-first order.
 *
 * @example
 * ```ts
 * selectTraversals(conversation, { mode: 'chosen', excluded: [oldAnswerId] }); // drops that answer and what followed it
 * ```
 */
export function selectTraversals(c: Conversation, selection: VersionSelection): NamedTraversal[] {
  const all = namedTraversals(c);
  let kept: NamedTraversal[];
  if (selection.mode === 'active') kept = all.filter((t) => t.active);
  else if (selection.mode === 'all') kept = all;
  else {
    const excluded = new Set(selection.excluded);
    kept = all.filter((t) => !t.nodeIds.some((id) => excluded.has(id)));
  }
  return [...kept.filter((t) => t.active), ...kept.filter((t) => !t.active)];
}

/** The node ids every given path shares from the root. */
export function sharedPrefix(paths: readonly (readonly string[])[]): string[] {
  if (paths.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const id = paths[0]![i];
    if (id === undefined || paths.some((p) => p[i] !== id)) return out;
    out.push(id);
  }
}

/** One node of `tree.json`. */
export interface TreeSummaryNode {
  id: string;
  parentId: string | null;
  role: Node['role'];
  createdAt?: string;
  hidden?: true;
  /** First 80 characters of the node's text, whitespace collapsed. */
  preview: string;
  childIds: string[];
  /** `2/3` style position among its siblings, when it has any. */
  version?: string;
  onActivePath?: true;
}

/** `tree.json`: the structure of a chat, small enough to read or diff, next to the exported documents. */
export interface TreeSummary {
  format: 'echoes-tree';
  formatVersion: 1;
  conversationId: string;
  title: string;
  activeLeafId: string;
  traversals: { name: string; leafId: string; active: boolean }[];
  nodes: TreeSummaryNode[];
}

/** Build the `tree.json` content. Nodes in depth-first order; deterministic. */
export function treeSummary(c: Conversation): TreeSummary {
  const onActive = new Set(activePath(c));
  const nodes: TreeSummaryNode[] = [];
  const visit = (id: string) => {
    const n = getNode(c, id);
    const out: TreeSummaryNode = { id, parentId: n.parentId, role: n.role, preview: previewOf(n), childIds: [...n.childIds] };
    if (n.createdAt) out.createdAt = n.createdAt;
    if (n.hidden) out.hidden = true;
    const siblings = n.parentId === null ? [] : getNode(c, n.parentId).childIds;
    if (siblings.length > 1) out.version = `${siblings.indexOf(id) + 1}/${siblings.length}`;
    if (onActive.has(id)) out.onActivePath = true;
    nodes.push(out);
    n.childIds.forEach(visit);
  };
  visit(c.rootId);
  return {
    format: 'echoes-tree',
    formatVersion: 1,
    conversationId: c.id,
    title: c.title,
    activeLeafId: c.activeLeafId,
    traversals: namedTraversals(c).map((t) => ({ name: t.name, leafId: t.leafId, active: t.active })),
    nodes,
  };
}

/** The first 80 characters of a node's visible text, whitespace collapsed. */
export function previewOf(n: Node): string {
  const text = n.blocks
    .map((b) => (b.kind === 'markdown' || b.kind === 'code' || b.kind === 'toolOutput' ? b.text : b.kind === 'reasoning' ? b.summary : b.kind === 'canvas' ? b.title : b.kind === 'widget' ? widgetText(b.view) : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  return chars.length > 80 ? `${chars.slice(0, 79).join('')}…` : text;
}
