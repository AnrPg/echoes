import { describe, expect, it } from 'vitest';
import { defaultMergeTitle, effectiveOrder, moveItem } from '../../src/pages/export/merge-model';

const chat = (id: string) => ({ id, title: id, updatedAt: '2026-10-01T00:00:00Z' });

describe('order of chats in one file', () => {
  it('keeps the user\'s order, drops unticked chats and adds newly ticked ones at the end', () => {
    expect(effectiveOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(effectiveOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(effectiveOrder(['c', 'a', 'b'], ['a', 'c', 'd'])).toEqual(['c', 'a', 'd']);
  });

  it('moves one item, clamping the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });

  it('titles the file after the Project when every ticked chat is in it', () => {
    const groups = [
      { name: 'Chats outside Projects', chats: [chat('a')] },
      { projectId: 'g-p-1', name: 'Thesis', chats: [chat('b'), chat('c')] },
    ];
    expect(defaultMergeTitle(groups, ['b', 'c'])).toBe('Thesis');
    expect(defaultMergeTitle(groups, ['a', 'b'])).toBe('ChatGPT chats');
    expect(defaultMergeTitle(groups, ['a'])).toBe('ChatGPT chats');
    expect(defaultMergeTitle(undefined, [])).toBe('ChatGPT chats');
  });
});
