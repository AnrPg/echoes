// Loading one chat, kept apart from the export runner so the service worker can use it without the renderers.

import { parseChatGptConversation, type AdapterWarning, type ChatGptConversationCapture } from '@echoes/adapter-chatgpt-api';
import type { Conversation, LineageRef } from '@echoes/core';

/** Fetch and parse one chat, with its recorded branch link. Adapter warnings are returned, not thrown. */
export async function loadChat(
  chatId: string,
  options: { source: { fetchConversation(id: string): Promise<ChatGptConversationCapture> }; lineage?: (id: string) => Promise<LineageRef | undefined> },
): Promise<{ conversation: Conversation; warnings: string[] }> {
  const parsed = parseChatGptConversation(await options.source.fetchConversation(chatId));
  const conversation: Conversation = structuredClone(parsed.conversation);
  const lineage = await options.lineage?.(chatId);
  if (lineage) conversation.lineage = lineage;
  return { conversation, warnings: parsed.warnings.map((w: AdapterWarning) => `${w.code}: ${w.message}`) };
}
