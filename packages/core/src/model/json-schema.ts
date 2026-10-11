import { z } from 'zod';
import { ConversationShapeSchema } from './schema.ts';
import { ExportManifestSchema } from '../output/manifest.ts';

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

/** `$id` of the published export manifest JSON Schema, version 1. */
export const MANIFEST_SCHEMA_ID = 'https://raw.githubusercontent.com/AnrPg/echoes/main/packages/core/schemas/export-manifest.v1.schema.json';

/**
 * JSON Schema (draft 2020-12) for an export's `manifest.json`, generated from the zod schema. Ships as
 * `@echoes/core/schemas/export-manifest.v1.schema.json`.
 */
export function manifestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ExportManifestSchema, { target: 'draft-2020-12', unrepresentable: 'any' });
  return { $id: MANIFEST_SCHEMA_ID, title: 'Echoes export manifest (manifestVersion 1)', ...schema };
}
