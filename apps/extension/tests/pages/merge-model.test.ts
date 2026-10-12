import { describe, expect, it } from 'vitest';
import { defaultMergeTitle, effectiveOrder, isNoopSlot, moveItem, moveToSlot, slotAt } from '../../src/pages/export/merge-model';

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

  it('drops a dragged row into the gap nearest the pointer', () => {
    const mids = [10, 30, 50]; // rows 0..20, 20..40, 40..60
    expect(slotAt(5, mids)).toBe(0);
    expect(slotAt(45, mids)).toBe(2); // top half of the third row: above it
    expect(slotAt(55, mids)).toBe(3); // bottom half of the last row: below it
    expect(slotAt(25, mids)).toBe(1);
    // The first row onto the top half of the third lands between the second and the third.
    expect(moveToSlot(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'a', 'c']);
    expect(moveToSlot(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
    // The third row onto the bottom half of the first lands between the first and the second.
    expect(moveToSlot(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveToSlot(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(isNoopSlot(1, 1) && isNoopSlot(1, 2)).toBe(true);
    expect(isNoopSlot(1, 0) || isNoopSlot(1, 3)).toBe(false);
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
