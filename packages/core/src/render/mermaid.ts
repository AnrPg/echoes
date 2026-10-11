import type { Conversation, Node } from '../model/schema.ts';
import { activePath, getNode } from '../model/tree.ts';
import { previewOf } from '../model/versions.ts';

export interface MermaidOptions {
  /** Wrap in a ```mermaid fence, ready to paste into Markdown. Default true. */
  fence?: boolean;
}

/**
 * A Mermaid flowchart of a chat's tree. Runs of messages without versions collapse into one box ("Turns 1–4"), so
 * the diagram shows only where the chat forks: each edge into a version is labelled "edited v2/3" or
 * "regenerated v1/2", and the branch the user sees is highlighted. Deterministic.
 *
 * @example
 * ```ts
 * renderMermaid(conversation, { fence: false });
 * // flowchart TD
 * //   s0["Turn 1: What is $2+2$?"]
 * //   s1["Turn 2: Prove it."]
 * //   s0 -->|"edited v1/2"| s1
 * ```
 */
export function renderMermaid(c: Conversation, options: MermaidOptions = {}): string {
  const onActive = new Set(activePath(c));
  const lines = ['flowchart TD'];
  const edges: string[] = [];
  const active: string[] = [];
  let next = 0;

  // A segment starts at the root or at a version and runs while each node has exactly one child.
  const segment = (startId: string, parentTurn: number): string => {
    const key = `s${next++}`;
    const nodes: Node[] = [];
    let id: string | undefined = startId;
    let turn = parentTurn;
    let last: Node | undefined;
    while (id !== undefined) {
      const n = getNode(c, id);
      if (n.role === 'user') turn++;
      nodes.push(n);
      last = n;
      id = n.childIds.length === 1 ? n.childIds[0] : undefined;
    }
    lines.push(`  ${key}["${label(nodes, parentTurn)}"]`);
    if (onActive.has(startId)) active.push(key);
    const kids = last!.childIds;
    kids.forEach((childId, i) => {
      const child = segment(childId, turn);
      const kind = getNode(c, childId).role === 'user' ? 'edited' : 'regenerated';
      edges.push(`  ${key} -->|"${kind} v${i + 1}/${kids.length}"| ${child}`);
    });
    return key;
  };

  segment(c.rootId, 0);
  lines.push(...edges);
  if (active.length) {
    lines.push('  classDef active stroke-width:3px', `  class ${active.join(',')} active`);
  }
  const body = lines.join('\n');
  return (options.fence ?? true) ? '```mermaid\n' + body + '\n```\n' : body + '\n';
}

function label(nodes: readonly Node[], parentTurn: number): string {
  const turns = new Set<number>();
  let t = parentTurn;
  for (const n of nodes) {
    if (n.role === 'user') t++;
    if (t > 0 && !n.hidden) turns.add(t);
  }
  const list = [...turns];
  const span = list.length === 0 ? 'Context' : list.length === 1 ? `Turn ${list[0]}` : `Turns ${list[0]}–${list.at(-1)}`;
  // The question, or for an answer the answer itself: "Worked for 3s" names no branch.
  const shown = (n: Node) => !n.hidden && n.blocks.some((b) => b.kind !== 'reasoning' && b.kind !== 'citation');
  const first = nodes.find((n) => n.role === 'user' && shown(n)) ?? nodes.find(shown) ?? nodes.find((n) => !n.hidden);
  const preview = first ? previewOf({ ...first, blocks: first.blocks.filter((b) => b.kind !== 'reasoning') }) : '';
  const text = preview ? `${span}: ${preview.length > 40 ? [...preview].slice(0, 39).join('') + '…' : preview}` : span;
  // Mermaid labels are quoted; quotes and a few characters must be entity-escaped.
  return text.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
}
