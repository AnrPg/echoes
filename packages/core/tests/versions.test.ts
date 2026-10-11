import { describe, expect, it } from 'vitest';
import {
  namedTraversals,
  parseConversation,
  renderMarkdown,
  renderMarkdownBranches,
  renderHtml,
  renderMermaid,
  selectTraversals,
  sharedPrefix,
  treeSummary,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

// The sample: Turn 2's question was edited (u2a, u2b), and the answer to the edit was regenerated (a2b1, a2b2).
const c = parseConversation(sampleJson());

describe('namedTraversals', () => {
  it('names each branch by the versions it takes', () => {
    expect(namedTraversals(c).map((t) => [t.leafId, t.name, t.active])).toEqual([
      ['a2a', 'Turn 2 edited (v1)', false],
      ['a2b1', 'Turn 2 edited (v2) to Turn 2 regenerated (v1)', false],
      ['a2b2', 'Turn 2 edited (v2) to Turn 2 regenerated (v2)', true],
    ]);
    expect(namedTraversals(c)[1]!.forks).toEqual([
      { turn: 2, kind: 'edited', version: 2, of: 2, nodeId: 'u2b' },
      { turn: 2, kind: 'regenerated', version: 1, of: 2, nodeId: 'a2b1' },
    ]);
  });

  it('a chat without versions has one "Only version"', () => {
    const linear = parseConversation({ ...sampleJson(), activeLeafId: 'a1', nodes: trimTo(['root', 'sys', 'u1', 'a1']) });
    expect(namedTraversals(linear).map((t) => t.name)).toEqual(['Only version']);
  });
});

describe('selectTraversals', () => {
  it('active, all, and chosen versions with their subtrees', () => {
    expect(selectTraversals(c, { mode: 'active' }).map((t) => t.leafId)).toEqual(['a2b2']);
    expect(selectTraversals(c, { mode: 'all' }).map((t) => t.leafId)).toEqual(['a2b2', 'a2a', 'a2b1']);
    // Dropping the edited question drops both answers under it.
    expect(selectTraversals(c, { mode: 'chosen', excluded: ['u2b'] }).map((t) => t.leafId)).toEqual(['a2a']);
    expect(selectTraversals(c, { mode: 'chosen', excluded: ['a2b1'] }).map((t) => t.leafId)).toEqual(['a2b2', 'a2a']);
  });

  it('sharedPrefix', () => {
    expect(sharedPrefix([['r', 'a', 'b'], ['r', 'a', 'c'], ['r', 'a']])).toEqual(['r', 'a']);
    expect(sharedPrefix([])).toEqual([]);
  });
});

describe('treeSummary and Mermaid', () => {
  it('tree.json lists nodes depth-first with versions, previews and the active path', () => {
    const t = treeSummary(c);
    expect(t.nodes.map((n) => [n.id, n.version ?? '', n.onActivePath ?? false])).toEqual([
      ['root', '', true], ['sys', '', true], ['u1', '', true], ['a1', '', true],
      ['u2a', '1/2', false], ['a2a', '', false], ['u2b', '2/2', true], ['a2b1', '1/2', false], ['a2b2', '2/2', true],
    ]);
    expect(t.nodes.find((n) => n.id === 'u2b')!.preview).toBe('Prove it in Python.');
    expect(t.traversals).toHaveLength(3);
    expect(JSON.stringify(treeSummary(c))).toBe(JSON.stringify(t)); // deterministic
  });

  it('Mermaid collapses runs and labels forks', () => {
    expect(renderMermaid(c)).toBe(
      [
        '```mermaid',
        'flowchart TD',
        '  s0["Turn 1: What is $2+2$?"]',
        '  s1["Turn 2: Prove it."]',
        '  s2["Turn 2: Prove it in Python."]',
        '  s3["Turn 2: assert 2 + 2 == 4"]',
        '  s4["Turn 2: print(2 + 2) 4 It printed 4."]',
        '  s0 -->|"edited v1/2"| s1',
        '  s2 -->|"regenerated v1/2"| s3',
        '  s2 -->|"regenerated v2/2"| s4',
        '  s0 -->|"edited v2/2"| s2',
        '  classDef active stroke-width:3px',
        '  class s0,s2,s4 active',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('escapes quotes and angle brackets in labels', () => {
    const q = parseConversation(sampleJson());
    (q.nodes['u1']!.blocks[0] as { text: string }).text = 'Say "hi" <b>';
    expect(renderMermaid(q, { fence: false })).toContain('s0["Turn 1: Say #quot;hi#quot; #lt;b#gt;"]');
  });
});

describe('Markdown for branches', () => {
  const all = selectTraversals(c, { mode: 'all' }).map((t) => ({ name: t.name, nodeIds: t.nodeIds }));

  it('one branch: a normal document with the branch named', () => {
    const md = renderMarkdownBranches(c, all.slice(0, 1));
    expect(md).toBe(renderMarkdown(c, { path: all[0]!.nodeIds, branchName: all[0]!.name }));
    expect(md).toContain('branch: "Turn 2 edited (v2) to Turn 2 regenerated (v2)"');
    expect(md).toContain('_Branch: Turn 2 edited (v2) to Turn 2 regenerated (v2)_');
  });

  it('several branches: shared turns once, then each branch one level deeper', () => {
    const md = renderMarkdownBranches(c, all);
    const headings = md.split('\n').filter((l) => l.startsWith('#'));
    expect(headings).toEqual([
      '# Sample: an edited question and a regenerated answer',
      '## Turn 1',
      '### User',
      '### Assistant',
      '## Branch 1 of 3: Turn 2 edited (v2) to Turn 2 regenerated (v2)',
      '### Turn 2',
      '#### User',
      '#### Assistant',
      '## Branch 2 of 3: Turn 2 edited (v1)',
      '### Turn 2',
      '#### User',
      '#### Assistant',
      '## Branch 3 of 3: Turn 2 edited (v2) to Turn 2 regenerated (v1)',
      '### Turn 2',
      '#### User',
      '#### Assistant',
    ]);
    expect(md).toContain('branches: 3');
  });
});

function trimTo(ids: string[]) {
  const nodes = sampleJson().nodes;
  const out: Record<string, (typeof nodes)[string]> = {};
  for (const id of ids) out[id] = { ...nodes[id]!, childIds: nodes[id]!.childIds.filter((k) => ids.includes(k)) };
  return out;
}

describe('selectedTurns', () => {
  it('renders only the chosen turns, keeping their numbers', () => {
    const md = renderMarkdown(c, { selectedTurns: [2] });
    expect(md).not.toContain('## Turn 1');
    expect(md).toContain('## Turn 2');
    const html = renderHtml(c, { selectedTurns: [1] });
    expect(html).toContain('id="turn-1"');
    expect(html).not.toContain('id="turn-2"');
  });
});
