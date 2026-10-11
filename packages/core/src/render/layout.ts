import type { Conversation, Node, Role } from '../model/schema.ts';
import type { Turn } from '../model/turns.ts';

/**
 * Document structure shared by the Markdown and HTML renderers: which messages go under one heading, and where a
 * path takes a version. Internal; not exported from the package.
 */

export type Group = { label: 'user' | 'assistant' | 'system'; nodes: Node[] };

/** Where a rendered path passes an edited question or a regenerated answer. */
export interface VersionNote {
  version: number;
  of: number;
  kind: 'edited question' | 'regenerated answer';
}

export function nodesOfTurn(turn: Turn): Node[] {
  return turn.question ? [turn.question, ...turn.responses] : turn.responses;
}

/**
 * Version notes for the path's forks. A note belongs to the first node of the chosen version, but when the turn
 * definition filtered that node out (a hidden context message heading a regenerated answer, say), it moves to the
 * next node that is rendered, so a version is never shown without saying it is one.
 */
export function versionNotes(c: Conversation, pathNodes: readonly Node[], rendered: ReadonlySet<string>): Map<string, VersionNote> {
  const notes = new Map<string, VersionNote>();
  let pending: VersionNote | undefined;
  for (const node of pathNodes) {
    const siblings = node.parentId === null ? [] : (c.nodes[node.parentId]?.childIds ?? []);
    if (siblings.length > 1) {
      pending = { version: siblings.indexOf(node.id) + 1, of: siblings.length, kind: node.role === 'user' ? 'edited question' : 'regenerated answer' };
    }
    if (pending && rendered.has(node.id)) {
      notes.set(node.id, pending);
      pending = undefined;
    }
  }
  return notes;
}

/** Consecutive nodes under one heading. Tool nodes go under the assistant. */
export function groupByLabel(nodes: readonly Node[]): Group[] {
  const groups: Group[] = [];
  for (const node of nodes) {
    const label = labelOf(node.role);
    const last = groups.at(-1);
    if (last && last.label === label) last.nodes.push(node);
    else groups.push({ label, nodes: [node] });
  }
  return groups;
}

function labelOf(role: Role): Group['label'] {
  return role === 'tool' ? 'assistant' : role;
}
