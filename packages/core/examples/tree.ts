// Load an Echoes conversation, walk its tree and split the active path into turns.
// Run: node examples/tree.ts
import { readFileSync } from 'node:fs';
import {
  TURN_PRESETS,
  activePath,
  applyTurnDefinition,
  buildTurns,
  nodesOf,
  parseConversation,
  pathThrough,
  traversals,
  versionGroups,
} from '@echoes/core';

export function main(): string[] {
  const json = readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8');
  const conversation = parseConversation(JSON.parse(json)); // throws EchoesValidationError with every issue
  const out: string[] = [];

  out.push(`active path: ${activePath(conversation).join(' > ')}`);
  out.push(`traversals: ${traversals(conversation).length}`);
  for (const g of versionGroups(conversation)) {
    out.push(`versions under ${g.parentId}: ${g.nodeIds.join(', ')} (showing ${g.activeIndex + 1}/${g.nodeIds.length})`);
  }

  // Choosing a version means choosing its subtree: the first version of the edited question, with its own answer.
  out.push(`path through u2a: ${pathThrough(conversation, 'u2a').join(' > ')}`);

  const turns = buildTurns(nodesOf(conversation, activePath(conversation)))
    .map((t) => applyTurnDefinition(t, TURN_PRESETS.studyNotes))
    .filter((t) => t.question || t.responses.length);
  for (const t of turns) {
    const kinds = t.responses.flatMap((n) => n.blocks.map((b) => b.kind));
    out.push(`turn ${t.index}: ${kinds.join(', ')}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
