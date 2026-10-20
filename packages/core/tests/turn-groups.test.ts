import { describe, expect, it } from 'vitest';
import { groupTurns, turnGroupFileName, turnGroupLabel } from '@echoes/core';

describe('groupTurns', () => {
  it('fills groups of N in turn order; the last holds what is left', () => {
    expect(groupTurns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5)).toEqual([
      { n: 1, turns: [1, 2, 3, 4, 5] },
      { n: 2, turns: [6, 7, 8, 9, 10] },
      { n: 3, turns: [11, 12] },
    ]);
  });

  it('counts picked turns, not turn numbers: gaps from a rule do not make short groups', () => {
    expect(groupTurns([2, 4, 6, 8, 10, 12], 5).map((g) => g.turns)).toEqual([[2, 4, 6, 8, 10], [12]]);
  });

  it('sorts and drops duplicates, so the same picks always give the same files', () => {
    expect(groupTurns([9, 2, 4, 2], 2).map((g) => g.turns)).toEqual([[2, 4], [9]]);
  });

  it('gives one group when N covers every pick, and none for no picks', () => {
    expect(groupTurns([3, 1], 5)).toEqual([{ n: 1, turns: [1, 3] }]);
    expect(groupTurns([], 5)).toEqual([]);
  });

  it('does not change its input', () => {
    const picks = [3, 1, 2];
    groupTurns(picks, 2);
    expect(picks).toEqual([3, 1, 2]);
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects size %s', (size) => {
    expect(() => groupTurns([1], size)).toThrow(RangeError);
  });
});

describe('turnGroupLabel and turnGroupFileName', () => {
  it('names the first and last turn, padded to two digits', () => {
    const groups = groupTurns([1, 2, 3, 4, 5, 6, 7], 5);
    expect(groups.map((g) => turnGroupLabel(g, groups))).toEqual(['turns-01-05', 'turns-06-07']);
    expect(groups.map((g) => turnGroupFileName('Chat title', g, groups))).toEqual(['Chat title_turns-01-05', 'Chat title_turns-06-07']);
  });

  it('names one turn for a group of one', () => {
    const groups = groupTurns([1, 2, 3], 2);
    expect(turnGroupLabel(groups[1]!, groups)).toBe('turns-03');
  });

  it('pads to the widest turn number, so names sort in turn order past 99', () => {
    const groups = groupTurns([8, 9, 99, 100, 120], 2);
    const labels = groups.map((g) => turnGroupLabel(g, groups));
    expect(labels).toEqual(['turns-008-009', 'turns-099-100', 'turns-120']);
    expect([...labels].sort()).toEqual(labels);
  });

  it('shows the real turn numbers when picks have gaps', () => {
    const groups = groupTurns([2, 9, 14], 2);
    expect(groups.map((g) => turnGroupLabel(g, groups))).toEqual(['turns-02-09', 'turns-14']);
  });
});
