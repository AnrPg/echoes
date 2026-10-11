// The branch monitor's log: each "Branch in new chat" the page bridge saw, stored by child chat id in the
// extension's IndexedDB. Exports attach it as the chat's lineage (evidence "recorded").

import { parseNewBranch } from '@echoes/adapter-chatgpt-api';
import { LineageRefSchema, STORE_COLLECTIONS, parseConversation, type Conversation, type LineageRef, type Store } from '@echoes/core';
import type { BranchMessage } from '../bridge/messages';

/** Record one branch creation. Returns the stored link. Throws if the bodies are not the shape Phase 0 saw. */
export async function recordBranch(store: Store, message: BranchMessage): Promise<LineageRef> {
  const b = parseNewBranch(message.request, message.response);
  const ref: LineageRef = {
    parentConversationId: b.parentConversationId,
    forkNodeId: b.forkMessageId,
    childConversationId: b.childConversationId,
    detectedAt: new Date(message.t).toISOString(),
    evidence: 'recorded',
    confidence: 1,
  };
  await store.put(STORE_COLLECTIONS.lineage, b.childConversationId, ref);
  return ref;
}

/**
 * Keep the source chat as it was when the branch was made (Build Plan §7), so the fork survives if the source is
 * later edited or deleted. `fetchParent` loads it now, through the ChatGPT tab that made the branch. Failure leaves
 * the link as it was: a link without a snapshot is still a link.
 */
export async function snapshotParent(store: Store, ref: LineageRef, fetchParent: (id: string) => Promise<Conversation>): Promise<boolean> {
  try {
    const parent = await fetchParent(ref.parentConversationId);
    const current = (await lineageFor(store, ref.childConversationId)) ?? ref;
    await store.put(STORE_COLLECTIONS.lineage, ref.childConversationId, { ...current, parentSnapshot: parent });
    return true;
  } catch (e) {
    console.warn('[echoes] could not snapshot the source of a branch', e);
    return false;
  }
}

/** The recorded link for a chat, if the monitor saw it being created. */
export async function lineageFor(store: Store, conversationId: string): Promise<LineageRef | undefined> {
  const raw = await store.get(STORE_COLLECTIONS.lineage, conversationId);
  const r = LineageRefSchema.safeParse(raw);
  if (!r.success) return undefined;
  const ref = r.data as LineageRef;
  // A snapshot is checked as a whole conversation (tree integrity too); a damaged one is dropped, not the link.
  if (ref.parentSnapshot) {
    try {
      ref.parentSnapshot = parseConversation(ref.parentSnapshot);
    } catch {
      delete ref.parentSnapshot;
    }
  }
  return ref;
}
