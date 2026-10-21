// Normalize, tokenize and find matches the way Echoes search does, across scripts; then search turns with typos
// and select turns with a rule, as the rule builder does.
// Run: node examples/search.ts
import { readFileSync } from 'node:fs';
import {
  TurnIndex,
  activePath,
  buildTurns,
  findMatches,
  groupTurns,
  nodesOf,
  normalizeText,
  parseConversation,
  selectTurns,
  tokenize,
  turnGroupFileName,
} from '@echoes/core';

const sample = parseConversation(JSON.parse(readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8')));

export function main(): string[] {
  const text = 'Η ΟΔΟΣ προς την Κωνσταντινούπολη (İstanbul) και 机器学习.';
  return [
    // The query and the text go through the same normalization: case, accents, final sigma, Turkish İ.
    `normalized: ${normalizeText(text)}`,
    `matches for "οδος": ${findMatches(text, 'οδος').map((r) => text.slice(r.start, r.end)).join(', ')}`,
    `matches for "istanbul": ${findMatches(text, 'istanbul').map((r) => text.slice(r.start, r.end)).join(', ')}`,
    // Terms for an index; Chinese becomes overlapping character pairs.
    `terms: ${tokenize(text).map((t) => t.term).join(' | ')}`,
    ...turnSearch(),
  ];
}

function turnSearch(): string[] {
  const turns = buildTurns(nodesOf(sample, activePath(sample)));
  const index = new TurnIndex();
  index.addTurns(sample.id, turns);
  return [
    // One typo is allowed in a 4 to 7 letter word; code and tool output are searched too.
    `search "pyhton": turns ${index.search('pyhton').map((h) => h.turn).join(', ')}`,
    `search "printed" in answers: turns ${index.search('printed', { fields: ['answer'] }).map((h) => h.turn).join(', ')}`,
    `rule "every 2nd turn, or has versions": turns ${selectTurns(sample, turns, {
      kind: 'or',
      rules: [{ kind: 'every', n: 2 }, { kind: 'hasVersions' }],
    }).join(', ')}`,
    // Picked turns in files of 1: one file per turn, named so they sort in turn order.
    ...groupFiles(),
  ];
}

function groupFiles(): string[] {
  const turns = buildTurns(nodesOf(sample, activePath(sample)));
  const groups = groupTurns(selectTurns(sample, turns, { kind: 'every', n: 1 }), 1);
  return groups.map((g) => `file ${g.n}: ${turnGroupFileName('Sample', g, groups)}.md has turns ${g.turns.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
