// Regenerates schemas/*.schema.json from the zod schemas. Run: pnpm --filter @echoes/core schema
import { writeFileSync } from 'node:fs';
import { conversationJsonSchema, manifestJsonSchema } from '../src/model/json-schema.ts';

for (const [name, schema] of [
  ['conversation.v1.schema.json', conversationJsonSchema()],
  ['export-manifest.v1.schema.json', manifestJsonSchema()],
] as const) {
  const out = new URL(`../schemas/${name}`, import.meta.url);
  writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote ${out.pathname}`);
}
