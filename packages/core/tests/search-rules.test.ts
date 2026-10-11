import { describe, expect, it } from 'vitest';
import {
  RuleError,
  TurnIndex,
  activePath,
  buildTurns,
  hasContent,
  nodesOf,
  parseConversation,
  parseRule,
  selectTurns,
  turnText,
  typoBudget,
  type Block,
  type Conversation,
  type Node,
  type Rule,
} from '@echoes/core';

/** A chat with one version fork; `turns` lists [question, answer blocks] in order on the active path. */
function chat(turns: [string, Block[]][], extra: Partial<Conversation> = {}): Conversation {
  const nodes: Record<string, Node> = { root: { id: 'root', parentId: null, childIds: [], role: 'system', blocks: [], hidden: true } };
  let parent = 'root';
  turns.forEach(([q, answer], i) => {
    const day = String(i + 1).padStart(2, '0');
    const u = `u${i + 1}`;
    const a = `a${i + 1}`;
    nodes[u] = { id: u, parentId: parent, childIds: [a], role: 'user', blocks: [{ kind: 'markdown', text: q }], hidden: false, createdAt: `2026-10-${day}T10:00:00Z` };
    nodes[a] = { id: a, parentId: u, childIds: [], role: 'assistant', blocks: answer, hidden: false, createdAt: `2026-10-${day}T10:01:00Z` };
    nodes[parent]!.childIds.unshift(u);
    parent = a;
  });
  // Turn 2's answer was regenerated: a sibling of a2 that is not on the active path.
  if (nodes['u2']) {
    nodes['a2old'] = { id: 'a2old', parentId: 'u2', childIds: [], role: 'assistant', blocks: [{ kind: 'markdown', text: 'old' }], hidden: false, createdAt: '2026-10-02T10:00:30Z' };
    nodes['u2'].childIds.unshift('a2old');
  }
  return parseConversation({
    schemaVersion: 1, id: 'c1', title: 'T', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
    sourceUrl: 'https://chatgpt.com/c/c1', rootId: 'root', activeLeafId: parent, nodes, model: 'gpt-5', ...extra,
  });
}

const md = (text: string): Block => ({ kind: 'markdown', text });
const c = chat([
  ['What is the Pythagorean theorem?', [md('In a right triangle \\(a^2 + b^2 = c^2\\).')]],
  ['Show me Python code', [md('```python\nprint(sum(range(10)))\n```')]],
  ['Compare in a table', [md('| a | b |\n| - | - |\n| 1 | 2 |')]],
  ['Τι είναι η ΟΔΟΣ;', [md('Η οδός είναι δρόμος. Use `user_id` and $5.'), { kind: 'citation', url: 'https://example.com', title: 'Example' }]],
  ['Draw a cat', [{ kind: 'image', generated: true, resource: { fileId: 'f1', status: 'ok' } }, { kind: 'reasoning', summary: 'Picking a style' }]],
]);
const turns = buildTurns(nodesOf(c, activePath(c)));
const select = (rule: Rule) => selectTurns(c, turns, rule);

describe('TurnIndex', () => {
  const index = new TurnIndex();
  index.addTurns(c.id, turns);

  it('scales typo tolerance with word length', () => {
    expect([typoBudget('cat'), typoBudget('code'), typoBudget('python'), typoBudget('机器')]).toEqual([0, 1, 2, 0]);
  });

  it('finds turns with typos, prefixes and other scripts', () => {
    expect(index.search('pythagorian').map((h) => h.turn)).toEqual([1]);
    expect(index.search('pyhton').map((h) => h.turn)).toEqual([2]); // swapped letters
    expect(index.search('cta')).toEqual([]); // short words need the exact spelling
    expect(index.search('pyth').map((h) => h.turn).sort()).toEqual([1, 2]);
    expect(index.search('οδος').map((h) => h.turn)).toEqual([4]);
    expect(index.search('ΔΡΌΜΟΣ').map((h) => h.turn)).toEqual([4]);
    expect(index.search('user', { fields: ['answer'] }).map((h) => h.turn)).toEqual([4]); // inside a code identifier
    expect(index.search('style').map((h) => h.turn)).toEqual([5]); // reasoning summary
  });

  it('searches code and LaTeX source as written', () => {
    expect(index.search('range').map((h) => h.turn)).toEqual([2]);
    expect(index.search('c^2').map((h) => h.turn)).toEqual([1]);
  });

  it('exact mode needs whole terms, and AND needs every term', () => {
    expect(index.search('pyth', { mode: 'exact' })).toEqual([]);
    expect(index.search('python cat')).toEqual([]);
    expect(index.search('python cat', { combine: 'or' }).map((h) => h.turn).sort()).toEqual([2, 5]);
    expect(index.search('  ')).toEqual([]);
  });

  it('replaces a conversation on re-add, filters by conversation, and survives a JSON round trip', () => {
    const i2 = new TurnIndex();
    i2.addTurns('c1', turns);
    i2.addTurns('c2', turns.slice(1, 2));
    i2.addTurns('c1', turns.slice(0, 3)); // turn 0 (hidden root) plus turns 1 and 2
    expect(i2.size).toBe(4);
    expect(i2.search('pythagorean').map((h) => h.conversationId)).toEqual(['c1', 'c2']);
    expect(i2.search('pythagorean', { conversationId: 'c2' })).toHaveLength(1);
    const back = TurnIndex.load(JSON.parse(JSON.stringify(i2.toJSON())))!;
    expect(back.search('pythagorean')).toEqual(i2.search('pythagorean'));
    expect(TurnIndex.load({ version: 999, index: {} })).toBeUndefined();
  });

  it('leaves hidden nodes out of turn text', () => {
    const hidden = { ...turns[0]!, question: { ...turns[0]!.question!, hidden: true } };
    expect(turnText(hidden).question).toBe('');
  });
});

describe('selectTurns', () => {
  it('position rules use 1-based turn numbers', () => {
    expect(select({ kind: 'every', n: 2 })).toEqual([1, 3, 5]);
    expect(select({ kind: 'every', n: 2, start: 2 })).toEqual([2, 4]);
    expect(select({ kind: 'range', from: 2, to: 3 })).toEqual([2, 3]);
    expect(select({ kind: 'first', n: 2 })).toEqual([1, 2]);
    expect(select({ kind: 'last', n: 2 })).toEqual([4, 5]);
  });

  it('text rules: fuzzy, exact substring and regex, per field', () => {
    expect(select({ kind: 'text', field: 'question', query: 'pythagorian', mode: 'fuzzy' })).toEqual([1]);
    expect(select({ kind: 'text', field: 'answer', query: 'pythagorian', mode: 'fuzzy' })).toEqual([]);
    expect(select({ kind: 'text', field: 'answer', query: 'sum(range', mode: 'exact' })).toEqual([2]);
    expect(select({ kind: 'text', field: 'either', query: 'Οδος', mode: 'exact' })).toEqual([4]);
    expect(select({ kind: 'text', field: 'answer', query: 'print\\(\\w+', mode: 'regex' })).toEqual([2]);
    expect(select({ kind: 'text', field: 'question', query: '^what', mode: 'regex' })).toEqual([1]);
    expect(select({ kind: 'text', field: 'question', query: '^what', mode: 'regex', caseSensitive: true })).toEqual([]);
  });

  it('content rules', () => {
    expect(select({ kind: 'has', content: 'math' })).toEqual([1]); // `$5` is not math
    expect(select({ kind: 'has', content: 'code' })).toEqual([2, 4]); // fence, inline code
    expect(select({ kind: 'has', content: 'table' })).toEqual([3]);
    expect(select({ kind: 'has', content: 'citation' })).toEqual([4]);
    expect(select({ kind: 'has', content: 'image' })).toEqual([5]);
    expect(select({ kind: 'has', content: 'attachment' })).toEqual([]);
    expect(select({ kind: 'has', content: 'code', negate: true })).toEqual([1, 3, 5]);
  });

  it('math inside code is code, not math', () => {
    const t = buildTurns(nodesOf(chat([['q', [md('`\\(x\\)`\n\n```\n\\[y\\]\n```')]]]), ['u1', 'a1']))[0]!;
    expect(hasContent(t, 'math')).toBe(false);
    expect(hasContent(t, 'code')).toBe(true);
  });

  it('metadata rules', () => {
    expect(select({ kind: 'model', model: 'GPT-5' })).toEqual([1, 2, 3, 4, 5]);
    expect(select({ kind: 'model', model: 'gpt-4o' })).toEqual([]);
    expect(select({ kind: 'date', from: '2026-10-02T00:00:00Z', to: '2026-10-03T23:59:59+00:00' })).toEqual([2, 3]);
    expect(select({ kind: 'hasVersions' })).toEqual([2]);
  });

  it('combines with and, or, not', () => {
    const rule: Rule = {
      kind: 'or',
      rules: [
        { kind: 'and', rules: [{ kind: 'has', content: 'code' }, { kind: 'not', rule: { kind: 'first', n: 2 } }] },
        { kind: 'text', field: 'either', query: 'cat', mode: 'fuzzy' },
      ],
    };
    expect(select(rule)).toEqual([4, 5]);
    expect(select({ kind: 'and', rules: [] })).toEqual([1, 2, 3, 4, 5]);
    expect(select({ kind: 'or', rules: [] })).toEqual([]);
  });

  it('never selects turn 0 (context before the first question)', () => {
    expect(turns[0]!.index).toBe(0);
    expect(select({ kind: 'not', rule: { kind: 'first', n: 1 } })).toEqual([2, 3, 4, 5]);
  });

  it('rejects invalid rules loudly', () => {
    expect(() => parseRule({ kind: 'every', n: 0 })).toThrow(RuleError);
    expect(() => parseRule({ kind: 'nope' })).toThrow(RuleError);
    expect(() => parseRule({ kind: 'not', rule: { kind: 'text', field: 'answer', query: '(', mode: 'regex' } })).toThrow(/invalid regular expression/);
    expect(parseRule({ kind: 'hasVersions' })).toEqual({ kind: 'hasVersions' });
  });
});
