import { activePath, buildTurns, nodesOf, parseConversation, selectTurns } from '@echoes/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONDITION_LABELS, RULE_WORDING, branchNameOf, buildRule, invert, newCondition, selectRange, summarize, versionChoices, type Condition } from '../../src/pages/export/picker-model';

// The core sample: Turn 2's question was edited (u2a, u2b), and the answer to the edit was regenerated (a2b1, a2b2).
const c = parseConversation(JSON.parse(readFileSync(new URL('../../../../packages/core/examples/sample-conversation.json', import.meta.url), 'utf8')));
const turns = buildTurns(nodesOf(c, activePath(c)));

describe('rule builder rows', () => {
  it('leaves out rows still being filled in, and combines the rest', () => {
    const text = { ...newCondition('text'), query: 'prove' } as Condition;
    expect(buildRule('and', [newCondition('text')])).toBeUndefined();
    expect(buildRule('and', [text])).toEqual({ kind: 'text', field: 'either', query: 'prove', mode: 'fuzzy' });
    expect(buildRule('or', [text, { ...newCondition('has'), not: true }])).toEqual({
      kind: 'or',
      rules: [
        { kind: 'text', field: 'either', query: 'prove', mode: 'fuzzy' },
        { kind: 'not', rule: { kind: 'has', content: 'code' } },
      ],
    });
  });

  it('orders a reversed range, drops invalid numbers, and makes whole days of dates', () => {
    expect(buildRule('and', [{ not: false, type: 'range', from: 5, to: 2 }])).toEqual({ kind: 'range', from: 2, to: 5 });
    expect(buildRule('and', [{ not: false, type: 'first', n: 0 }])).toBeUndefined();
    expect(buildRule('and', [{ not: false, type: 'date', from: '', to: '2026-10-02' }])).toEqual({ kind: 'date', to: '2026-10-02T23:59:59.999Z' });
  });

  it('every rule the builder makes is one core accepts', () => {
    const types = ['every', 'range', 'first', 'last', 'has', 'hasVersions'] as const;
    for (const t of types) expect(() => selectTurns(c, turns, buildRule('and', [newCondition(t)])!)).not.toThrow();
    expect(selectTurns(c, turns, buildRule('and', [newCondition('hasVersions')])!)).toEqual([2]);
  });
});

describe('selection helpers', () => {
  it('shift-click sets the whole range either way round', () => {
    expect([...selectRange(new Set([1]), [1, 2, 3, 4], 4, 2, true)].sort()).toEqual([1, 2, 3, 4]);
    expect([...selectRange(new Set([1, 2, 3, 4]), [1, 2, 3, 4], 1, 3, false)]).toEqual([4]);
    expect([...invert(new Set([1, 3]), [1, 2, 3, 4])]).toEqual([2, 4]);
  });
});

describe('turn summaries and versions', () => {
  it('shows answer text without Markdown marks', () => {
    const json = JSON.parse(JSON.stringify(c));
    json.nodes.a1.blocks = [{ kind: 'markdown', text: '## Result\n**Bold**, `code` and [a link](https://x.y).' }];
    const t = buildTurns(nodesOf(parseConversation(json), activePath(c)))[1]!;
    expect(summarize(parseConversation(json), t).answer).toBe('Result Bold, code and a link.');
  });

  it('shows the question, the answer and what the turn has', () => {
    const s = summarize(c, turns[1]!);
    expect(s.index).toBe(1);
    expect(s.question).toBe('What is $2+2$?');
    expect(s.answer).toBe('$2+2=4$.');
    expect(s.versions).toEqual([]);
  });

  it('offers each version of an edited question and a regenerated answer, with its path', () => {
    const t2 = turns.find((t) => t.index === 2)!;
    const vs = versionChoices(c, t2);
    expect(vs.map((v) => [v.kind, v.version, v.of, v.current])).toEqual([
      ['question', 1, 2, false],
      ['question', 2, 2, true],
      ['answer', 1, 2, false],
      ['answer', 2, 2, true],
    ]);
    expect(vs[0]!.path.at(-1)).toBe('a2a');
    expect(branchNameOf(c, vs[0]!.path)).toBe('Turn 2: question version 1 of 2');
  });
});

describe('rule rows read as sentences', () => {
  it('puts the negation in the verb, never as an "Is not" prefix', () => {
    for (const [type, w] of Object.entries(RULE_WORDING)) {
      expect(w.subject, type).toMatch(/^The\b/);
      expect(w.no, type).toMatch(/n't\b/);
      expect(w.no.toLowerCase().startsWith('is not'), type).toBe(false);
    }
    expect(Object.keys(RULE_WORDING).sort()).toEqual(Object.keys(CONDITION_LABELS).sort());
    expect(`${RULE_WORDING.has.subject} ${RULE_WORDING.has.no} code`).toBe("The turn doesn't have code");
  });
});
