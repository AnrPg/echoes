import { describe, expect, it } from 'vitest';
import {
  TreeError, activePath, leaves, parseConversation, pathThrough, pathTo, subtree, traversals, versionGroups,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

const c = parseConversation(sampleJson());

describe('tree', () => {
  it('follows activeLeafId to the root', () => {
    expect(activePath(c)).toEqual(['root', 'sys', 'u1', 'a1', 'u2b', 'a2b2']);
  });

  it('lists the subtree in childIds order, depth first', () => {
    expect(subtree(c, 'a1')).toEqual(['a1', 'u2a', 'a2a', 'u2b', 'a2b1', 'a2b2']);
  });

  it('has one traversal per leaf, exactly one active', () => {
    expect(leaves(c)).toEqual(['a2a', 'a2b1', 'a2b2']);
    const ts = traversals(c);
    expect(ts.map((t) => t.leafId)).toEqual(['a2a', 'a2b1', 'a2b2']);
    expect(ts.filter((t) => t.active).map((t) => t.leafId)).toEqual(['a2b2']);
    expect(ts[1]!.nodeIds).toEqual(['root', 'sys', 'u1', 'a1', 'u2b', 'a2b1']);
  });

  it('finds version groups and the active version in each', () => {
    expect(versionGroups(c)).toEqual([
      { parentId: 'a1', nodeIds: ['u2a', 'u2b'], activeIndex: 1 },
      { parentId: 'u2b', nodeIds: ['a2b1', 'a2b2'], activeIndex: 1 },
    ]);
  });

  it('reports activeIndex -1 for groups off the active path', () => {
    const d = sampleJson() as any;
    d.nodes.u2a.childIds.push('a2a2');
    d.nodes.a2a2 = { id: 'a2a2', parentId: 'u2a', childIds: [], role: 'assistant', blocks: [], hidden: false };
    expect(versionGroups(parseConversation(d)).find((g) => g.parentId === 'u2a')!.activeIndex).toBe(-1);
  });

  it('choosing a version carries its own subtree', () => {
    expect(pathThrough(c, 'u2a')).toEqual(['root', 'sys', 'u1', 'a1', 'u2a', 'a2a']);
    // Below a node on the active path it stays on the active path.
    expect(pathThrough(c, 'u1')).toEqual(activePath(c));
    // Off the active path it picks the most recent child.
    const d = sampleJson() as any;
    d.nodes.u2a.childIds.push('a2a2');
    d.nodes.a2a2 = { id: 'a2a2', parentId: 'u2a', childIds: [], role: 'assistant', blocks: [], hidden: false };
    expect(pathThrough(parseConversation(d), 'u2a').at(-1)).toBe('a2a2');
  });

  it('throws TreeError for unknown ids', () => {
    expect(() => pathTo(c, 'nope')).toThrow(TreeError);
  });

  it('handles deep chats without recursion limits', () => {
    const n = 20_000;
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      nodes[`n${i}`] = {
        id: `n${i}`, parentId: i ? `n${i - 1}` : null, childIds: i < n - 1 ? [`n${i + 1}`] : [],
        role: i % 2 ? 'assistant' : 'user', blocks: [], hidden: false,
      };
    }
    const deep = parseConversation({ ...sampleJson(), rootId: 'n0', activeLeafId: `n${n - 1}`, nodes });
    expect(activePath(deep)).toHaveLength(n);
    expect(traversals(deep)).toHaveLength(1);
  });
});
