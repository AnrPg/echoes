import { MemoryStore, STORE_COLLECTIONS, parseConversation } from '@echoes/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chatIdFromUrl, exportPageUrl } from '../../src/background/routes';
import { lineageFor, recordBranch, snapshotParent } from '../../src/host/lineage';

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

describe('parent snapshot', () => {
  const sample = () => parseConversation(JSON.parse(readFileSync(new URL('../../../../packages/core/examples/sample-conversation.json', import.meta.url), 'utf8')));
  const branch = { type: 'echoes:branch' as const, t: 0, request: { conversation_id: 'parent', message_id: 'fork' }, response: { conversation: { conversation_id: 'child', current_node: 'leaf' } } };

  it('keeps the source chat as it was at branch time, with the link', async () => {
    const store = new MemoryStore();
    const ref = await recordBranch(store, branch);
    const asked: string[] = [];
    expect(await snapshotParent(store, ref, async (id) => (asked.push(id), sample()))).toBe(true);
    expect(asked).toEqual(['parent']);
    const got = await lineageFor(store, 'child');
    expect(got).toMatchObject({ parentConversationId: 'parent', evidence: 'recorded' });
    expect(got!.parentSnapshot).toEqual(sample());
  });

  it('a failed fetch keeps the link without a snapshot', async () => {
    const store = new MemoryStore();
    const ref = await recordBranch(store, branch);
    expect(await snapshotParent(store, ref, async () => Promise.reject(new Error('tab closed')))).toBe(false);
    expect((await lineageFor(store, 'child'))?.parentSnapshot).toBeUndefined();
  });

  it('a damaged snapshot is dropped, not the link', async () => {
    const store = new MemoryStore();
    const ref = await recordBranch(store, branch);
    await store.put(STORE_COLLECTIONS.lineage, 'child', { ...ref, parentSnapshot: { ...sample(), activeLeafId: 'nope' } });
    const got = await lineageFor(store, 'child');
    expect(got).toMatchObject({ parentConversationId: 'parent' });
    expect(got!.parentSnapshot).toBeUndefined();
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
