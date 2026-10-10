import { expect, it } from 'vitest';
import { main as parse } from '../examples/parse.ts';

// Examples are documentation; this keeps the example runnable and its printed output accurate.
it('examples/parse.ts', () => {
  expect(parse()).toEqual([
    'older page to fetch: yes; messages with versions: 1',
    'nodes: 139, active path: 130, turns: 16',
    'versions of one answer: 2 (showing 2/2)',
    'original version path: 9 messages after the question',
    'warning earlier-messages-not-fetched: the oldest page given still has older pages; history before it is missing',
  ]);
});
