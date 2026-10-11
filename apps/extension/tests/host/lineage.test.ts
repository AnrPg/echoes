import { MemoryStore } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { chatIdFromUrl, exportPageUrl } from '../../src/background/routes';
import { lineageFor, recordBranch } from '../../src/host/lineage';

describe('branch log', () => {
  it('stores a recorded link by child chat and reads it back', async () => {
    const store = new MemoryStore();
    await recordBranch(store, {
      type: 'echoes:branch',
      t: Date.UTC(2026, 9, 10, 20, 32, 26),
      request: { conversation_id: 'parent', message_id: 'fork' },
      response: { conversation: { conversation_id: 'child', current_node: 'leaf' } },
    });
    expect(await lineageFor(store, 'child')).toEqual({
      parentConversationId: 'parent',
      forkNodeId: 'fork',
      childConversationId: 'child',
      detectedAt: '2026-10-10T20:32:26.000Z',
      evidence: 'recorded',
      confidence: 1,
    });
    expect(await lineageFor(store, 'parent')).toBeUndefined();
    await expect(recordBranch(store, { type: 'echoes:branch', t: 0, request: {}, response: {} })).rejects.toThrow();
  });
});

describe('routes', () => {
  it('reads the chat id from chat and Project chat URLs', () => {
    expect(chatIdFromUrl('https://chatgpt.com/c/68e9-ab12')).toBe('68e9-ab12');
    expect(chatIdFromUrl('https://chatgpt.com/g/g-p-123-thesis/c/68e9-ab12')).toBe('68e9-ab12');
    expect(chatIdFromUrl('https://chatgpt.com/')).toBeUndefined();
    expect(chatIdFromUrl('https://chatgpt.com/g/g-p-123-thesis/project')).toBeUndefined();
    expect(exportPageUrl('p.html', 7, 'c1')).toBe('p.html?tab=7&chat=c1');
    expect(exportPageUrl('p.html', undefined, undefined)).toBe('p.html');
  });
});
