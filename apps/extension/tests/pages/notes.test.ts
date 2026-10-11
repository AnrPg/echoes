import { describe, expect, it } from 'vitest';
import { summarizeWarnings } from '../../src/pages/export/notes.ts';

describe('summarizeWarnings', () => {
  it('collapses repeated notes with a count, in first-seen order, without codes', () => {
    const file = 'unknown-reference-type: unknown content reference type "file"; its text was kept';
    expect(summarizeWarnings([file, 'later-messages-not-fetched: the turns after x were not loaded', file, file])).toEqual([
      'unknown content reference type "file"; its text was kept (3 times)',
      'the turns after x were not loaded',
    ]);
  });
});
