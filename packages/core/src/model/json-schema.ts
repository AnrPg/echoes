import { z } from 'zod';
import { ConversationShapeSchema } from './schema.ts';

/** `$id` of the published Echoes conversation JSON Schema, version 1. */
export const CONVERSATION_SCHEMA_ID = 'https://raw.githubusercontent.com/AnrPg/echoes/main/packages/core/schemas/conversation.v1.schema.json';

/**
 * JSON Schema (draft 2020-12) for Echoes conversation JSON, generated from the zod schemas. It covers field shapes
 * only; tree integrity is checked by {@link parseConversation}. The same document ships as
 * `@echoes/core/schemas/conversation.v1.schema.json`.
 */
export function conversationJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ConversationShapeSchema, { target: 'draft-2020-12', unrepresentable: 'any' });
  return { $id: CONVERSATION_SCHEMA_ID, title: 'Echoes conversation (schemaVersion 1)', ...schema };
}
