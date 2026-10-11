import { describe, expect, it } from 'vitest';
import {
  ChatSkeletonSchema,
  MemoryStore,
  chatSkeleton,
  inferLineage,
  lineageFromMetadata,
  parseConversation,
  pathThrough,
  sharedHistory,
  type Conversation,
  type Node,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

// The sample: u1 → a1 → (u2a → a2a | u2b → a2b1 | a2b2). "Branch in new chat" from a2a copies root…a2a.
const parent = parseConversation(sampleJson());
const NOW = '2026-10-11T12:00:00Z';

/**
 * A chat branched from `parent` at `forkId`: the path up to the fork copied, then `extra` new messages. `renameIds`
 * gives the copies new ids (the API may or may not keep them); `keepTimes` keeps their creation times.
 */
function branchOf(forkId: string, opts: { id?: string; renameIds?: boolean; keepTimes?: boolean; extra?: number; createdAt?: string } = {}): Conversation {
  const { id = 'child', renameIds = true, keepTimes = true, extra = 1, createdAt = '2026-10-05T00:00:00Z' } = opts;
  const path = pathThrough(parent, forkId).slice(0, pathThrough(parent, forkId).indexOf(forkId) + 1);
  const rename = (x: string) => (renameIds && x !== parent.rootId ? `c-${x}` : x);
  const nodes: Record<string, Node> = {};
  path.forEach((nid, i) => {
    const n = parent.nodes[nid]!;
    const copy: Node = { ...structuredClone(n), id: rename(nid), parentId: i === 0 ? null : rename(path[i - 1]!), childIds: i < path.length - 1 ? [rename(path[i + 1]!)] : [] };
    if (!keepTimes) delete copy.createdAt;
    nodes[copy.id] = copy;
  });
  let last = rename(forkId);
  for (let k = 0; k < extra; k++) {
    const nid = `new${k}`;
    nodes[nid] = { id: nid, parentId: last, childIds: [], role: k % 2 ? 'assistant' : 'user', blocks: [{ kind: 'markdown', text: `New message ${k}` }], createdAt: '2026-10-05T00:00:10Z', hidden: false };
    nodes[last]!.childIds = [nid];
    last = nid;
  }
  return parseConversation({ ...parent, id, title: 'Branch', createdAt, updatedAt: createdAt, sourceUrl: `https://chatgpt.com/c/${id}`, rootId: rename(path[0]!), activeLeafId: last, nodes });
}

describe('sharedHistory', () => {
  it('finds the fork on a version that is not the parent\'s active one', () => {
    const h = sharedHistory(chatSkeleton(parent), chatSkeleton(branchOf('a2a')));
    expect(h).toEqual({ shared: 4, strong: 4, parentNodeId: 'a2a', childNodeId: 'c-a2a', childLength: 5 });
  });

  it('matches copies by content when ids and times differ, as weak matches', () => {
    const h = sharedHistory(chatSkeleton(parent), chatSkeleton(branchOf('a1', { keepTimes: false })));
    expect(h).toMatchObject({ shared: 2, strong: 0, parentNodeId: 'a1' });
  });
});

describe('inferLineage', () => {
  it('links a branch to its source with high confidence when times match', () => {
    const link = inferLineage(chatSkeleton(branchOf('a2b1')), [chatSkeleton(parent)], { now: NOW });
    expect(link).toEqual({ parentConversationId: parent.id, forkNodeId: 'a2b1', childConversationId: 'child', detectedAt: NOW, evidence: 'inferred', confidence: 0.95 });
  });

  it('is less sure on content alone, and needs a question and an answer', () => {
    expect(inferLineage(chatSkeleton(branchOf('a1', { keepTimes: false })), [chatSkeleton(parent)], { now: NOW })?.confidence).toBe(0.5);
    expect(inferLineage(chatSkeleton(branchOf('u1')), [chatSkeleton(parent)], { now: NOW })).toBeUndefined();
  });

  it('picks the longest shared start, and only among older chats', () => {
    const first = branchOf('a1', { id: 'first', createdAt: '2026-10-03T00:00:00Z', extra: 2 });
    const grandchild = branchOf('a2a', { id: 'grand' });
    expect(inferLineage(chatSkeleton(grandchild), [chatSkeleton(first), chatSkeleton(parent)], { now: NOW })?.parentConversationId).toBe(parent.id);
    // The parent is never linked to its own branch: the branch is newer.
    expect(inferLineage(chatSkeleton(parent), [chatSkeleton(branchOf('a2a'))], { now: NOW })).toBeUndefined();
  });

  it('halves confidence when two sources share just as much, and picks the older', () => {
    const twin = branchOf('a2a', { id: 'twin', createdAt: '2026-10-02T00:00:00Z', extra: 0 });
    const link = inferLineage(chatSkeleton(branchOf('a2a')), [chatSkeleton(twin), chatSkeleton(parent)], { now: NOW });
    expect(link).toMatchObject({ parentConversationId: parent.id, confidence: 0.48 });
  });
});

describe('lineageFromMetadata', () => {
  it('finds the fork in the source ChatGPT named', () => {
    expect(lineageFromMetadata(chatSkeleton(branchOf('u2b')), chatSkeleton(parent), NOW)).toEqual({
      parentConversationId: parent.id,
      forkNodeId: 'u2b',
      childConversationId: 'child',
      detectedAt: NOW,
      evidence: 'api-metadata',
      confidence: 1,
    });
  });
});

describe('chatSkeleton', () => {
  it('is plain data a store keeps, and parses back', async () => {
    const store = new MemoryStore();
    await store.put('s', parent.id, chatSkeleton(parent));
    expect(ChatSkeletonSchema.parse(await store.get('s', parent.id))).toEqual(chatSkeleton(parent));
    expect(chatSkeleton(parent).nodes['sys']!.sig).toBeUndefined(); // hidden messages are not compared
  });
});
