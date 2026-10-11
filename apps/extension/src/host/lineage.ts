// The branch monitor's log: each "Branch in new chat" the page bridge saw, stored by child chat id in the
// extension's IndexedDB. Exports attach it as the chat's lineage (evidence "recorded").

import { parseNewBranch } from '@echoes/adapter-chatgpt-api';
import { LineageRefSchema, STORE_COLLECTIONS, type LineageRef, type Store } from '@echoes/core';
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

/** The recorded link for a chat, if the monitor saw it being created. */
export async function lineageFor(store: Store, conversationId: string): Promise<LineageRef | undefined> {
  const raw = await store.get(STORE_COLLECTIONS.lineage, conversationId);
  const r = LineageRefSchema.safeParse(raw);
  return r.success ? (r.data as LineageRef) : undefined;
}
