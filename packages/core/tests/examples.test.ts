import { expect, it } from 'vitest';
import { main as tree } from '../examples/tree.ts';
import { main as scheduler } from '../examples/scheduler.ts';
import { main as render } from '../examples/render.ts';
import { main as search } from '../examples/search.ts';

// Examples are documentation; these tests keep them runnable and their printed output accurate.
it('examples/tree.ts', () => {
  expect(tree()).toEqual([
    'active path: root > sys > u1 > a1 > u2b > a2b2',
    'traversals: 3',
    'versions under a1: u2a, u2b (showing 2/2)',
    'versions under u2b: a2b1, a2b2 (showing 2/2)',
    'path through u2a: root > sys > u1 > a1 > u2a > a2a',
    'turn 1: markdown',
    'turn 2: markdown, citation, unknown',
  ]);
});

it('examples/scheduler.ts', async () => {
  expect(await scheduler()).toEqual([
    'event: request', 'event: response', 'event: paused (auth)', 'event: resumed',
    'event: request', 'event: response', 'status: 200',
  ]);
});

it('examples/render.ts', () => {
  expect(render()).toEqual([
    'github: Area $`\\pi r^2`$ costs \\$5; run `echo $HOME`.',
    'obsidian: Area $\\pi r^2$ costs \\$5; run `echo $HOME`.',
    'commonmark: Area $\\pi r^2$ costs \\$5; run `echo $HOME`.',
    '# Sample: an edited question and a regenerated answer',
    '## Turn 1', '### User', '### Assistant',
    '## Turn 2', '### User', '_Version 1 of 2 (edited question)_', '### Assistant',
  ]);
});

it('examples/search.ts', () => {
  expect(search()).toEqual([
    'normalized: η οδοσ προσ την κωνσταντινουπολη (istanbul) και 机器学习.',
    'matches for "οδος": ΟΔΟΣ',
    'matches for "istanbul": İstanbul',
    'terms: η | οδοσ | προσ | την | κωνσταντινουπολη | istanbul | και | 机器 | 器学 | 学习',
  ]);
});
