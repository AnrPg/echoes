import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { walkWidget, type WidgetNode } from '@echoes/core';
import { splitLayoutMarkup, type LayoutSegment } from '../src/markup.ts';

// The four template widgets of a real chat, exactly as the API returned them in an answer's text (captured
// 2026-10-11; one sentence reworded to remove personal detail): a checklist with a counter and a reset button, and
// three "pick one" widgets whose details change with the pick.
const SOURCES: string[] = JSON.parse(readFileSync(new URL('./fixtures/recipe-widgets.json', import.meta.url), 'utf8'));

const read = (source: string) => {
  const r = splitLayoutMarkup(`Πριν.\n\n${source}\n\nΜετά.`);
  expect(r.segments.map((s) => s.kind)).toEqual(['markdown', 'widget', 'markdown']);
  expect(r.unreadableWidgets).toBe(0);
  const w = r.segments[1] as Extract<LayoutSegment, { kind: 'widget' }>;
  expect(w.source).toBe(source);
  return w.view;
};
const nodes = (view: WidgetNode[], type: WidgetNode['type']) => [...walkWidget(view)].filter((n) => n.type === type);

describe('real ChatGPT template widgets', () => {
  it('read without loss (golden views)', async () => {
    await expect(JSON.stringify(SOURCES.map(read), null, 2) + '\n').toMatchFileSnapshot('golden/recipe-widgets.views.json');
  });

  it('checklist: every item, the counter and the reset button', () => {
    const view = read(SOURCES[0]!);
    expect(nodes(view, 'checkbox')).toHaveLength(17);
    expect(nodes(view, 'checkbox').every((c) => c.type === 'checkbox' && !c.checked && c.label.length > 0)).toBe(true);
    expect(nodes(view, 'counter')).toHaveLength(1);
    expect(nodes(view, 'reset')).toEqual([{ type: 'reset', label: 'Καθαρισμός λίστας' }]);
  });

  it('choices: options, the starting pick, and one case per option for everything that depends on it', () => {
    for (const [i, selected] of [[1, 1], [2, 0], [3, 0]] as const) {
      const view = read(SOURCES[i]!);
      const [choice] = nodes(view, 'choice');
      expect(choice).toMatchObject({ type: 'choice', selected });
      const options = (choice as Extract<WidgetNode, { type: 'choice' }>).options.length;
      expect(options).toBe(3);
      const switches = nodes(view, 'switch') as Extract<WidgetNode, { type: 'switch' }>[];
      expect(switches.length).toBeGreaterThan(0);
      for (const s of switches) expect(s.cases).toHaveLength(options);
    }
    // The amounts of the second widget follow the pick: 25/15/0, 40/25/10, 65/45/20 g.
    const amounts = (nodes(read(SOURCES[1]!), 'switch')[0] as Extract<WidgetNode, { type: 'switch' }>).cases.map((c) =>
      [...walkWidget(c)].flatMap((n) => (n.type === 'markdown' ? [...n.text.matchAll(/\*\*(\d+) γρ\.\*\*/g)].map((m) => Number(m[1])) : [])),
    );
    expect(amounts).toEqual([[25, 15, 0], [40, 25, 10], [65, 45, 20]]);
  });
});
