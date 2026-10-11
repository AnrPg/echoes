import { describe, expect, it } from 'vitest';
import { freshenGroups, scopeOf } from '../../src/pages/export/freshen';

const chat = (id: string, updatedAt: string, projectId?: string) => ({ id, title: id, updatedAt, ...(projectId ? { projectId } : {}) });

describe('freshen the chat list before an export', () => {
  const groups = [
    { name: 'Chats', chats: [chat('a', '2026-10-01')] },
    { projectId: 'g-p-1', name: 'Hindi', chats: [chat('h1', '2026-10-01', 'g-p-1'), chat('h2', '2026-10-01', 'g-p-1')] },
    { projectId: 'g-p-2', name: 'Other', chats: [chat('o1', '2026-10-01', 'g-p-2')] },
  ];

  it('re-lists only the groups the selection touches', () => {
    expect(scopeOf(groups, new Set(['h2']))).toEqual({ mainList: false, projectIds: ['g-p-1'] });
    expect(scopeOf(groups, new Set(['a', 'o1']))).toEqual({ mainList: true, projectIds: ['g-p-2'] });
  });

  it('takes the new dates and new chats of re-listed groups, and keeps the rest as they were', () => {
    const fresh = freshenGroups(groups, { projects: [{ id: 'g-p-1', name: 'Hindi', chats: [chat('h3', '2026-10-11', 'g-p-1'), chat('h1', '2026-10-11', 'g-p-1'), chat('h2', '2026-10-01', 'g-p-1')] }] });
    expect(fresh[1]!.chats.map((c) => [c.id, c.updatedAt])).toEqual([
      ['h3', '2026-10-11'],
      ['h1', '2026-10-11'],
      ['h2', '2026-10-01'],
    ]);
    expect(fresh[0]).toBe(groups[0]);
    expect(fresh[2]).toBe(groups[2]);
  });
});
