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

/** How a multi-branch document introduces and titles its branches. */
export interface BranchPlan {
  /** A sentence for the top of the branches part: how many there are and what was already shown. */
  intro: string;
  /** "Branch 1 of 3", marked when it is the branch the chat shows. */
  titles: string[];
  /** For branch `i`: the earlier branch a turn's messages were already shown under ("Branch 1"), else undefined. */
  shownBefore(i: number): (nodes: readonly Node[]) => string | undefined;
}

/**
 * Titles and repeats for {@link BranchPlan}. `shared` is the prefix every branch has (shown once, before the
 * branches); a turn whose messages all appeared in an earlier branch is pointed to instead of repeated.
 */
export function branchPlan(c: Conversation, branches: readonly { nodeIds: readonly string[] }[], shared: ReadonlySet<string>): BranchPlan {
  const n = branches.length;
  const titles = branches.map((b, i) => `Branch ${i + 1} of ${n}${b.nodeIds.at(-1) === c.activeLeafId ? ' (the one shown in the chat)' : ''}`);
  const questions = branches[0]?.nodeIds.filter((id) => shared.has(id) && c.nodes[id]?.role === 'user' && !c.nodes[id]?.hidden).length ?? 0;
  const same = questions === 0 ? '' : questions === 1 ? ' Turn 1 is the same in all of them and is shown once, above.' : ` Turns 1–${questions} are the same in all of them and are shown once, above.`;
  const intro = `This chat has ${n} branches.${same} Each branch below shows only its own messages; a turn that an earlier branch already showed is not repeated.`;
  const sets = branches.map((b) => new Set(b.nodeIds));
  return {
    intro,
    titles,
    shownBefore: (i) => (nodes) => {
      for (let j = 0; j < i; j++) if (nodes.every((x) => sets[j]!.has(x.id))) return `Branch ${j + 1}`;
      return undefined;
    },
  };
}
