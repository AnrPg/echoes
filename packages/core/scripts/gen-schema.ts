// Regenerates schemas/*.schema.json from the zod schemas. Run: pnpm --filter @echoes/core schema
import { writeFileSync } from 'node:fs';
import { conversationJsonSchema } from '../src/model/json-schema.ts';

const out = new URL('../schemas/conversation.v1.schema.json', import.meta.url);
writeFileSync(out, JSON.stringify(conversationJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
