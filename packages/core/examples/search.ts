// Normalize, tokenize and find matches the way Echoes search does, across scripts.
// Run: node examples/search.ts
import { findMatches, normalizeText, tokenize } from '@echoes/core';

export function main(): string[] {
  const text = 'Η ΟΔΟΣ προς την Κωνσταντινούπολη (İstanbul) και 机器学习.';
  return [
    // The query and the text go through the same normalization: case, accents, final sigma, Turkish İ.
    `normalized: ${normalizeText(text)}`,
    `matches for "οδος": ${findMatches(text, 'οδος').map((r) => text.slice(r.start, r.end)).join(', ')}`,
    `matches for "istanbul": ${findMatches(text, 'istanbul').map((r) => text.slice(r.start, r.end)).join(', ')}`,
    // Terms for an index; Chinese becomes overlapping character pairs.
    `terms: ${tokenize(text).map((t) => t.term).join(' | ')}`,
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
