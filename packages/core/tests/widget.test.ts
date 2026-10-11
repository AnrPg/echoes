import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BlockSchema,
  WIDGET_STATIC_LABEL,
  parseConversation,
  renderHtml,
  renderJson,
  renderMarkdown,
  widgetText,
  widgetToHtml,
  widgetToMarkdown,
  type Block,
  type Conversation,
  type WidgetNode,
} from '@echoes/core';

// Two widgets read by the ChatGPT adapter from answers exported on 2026-10-11: a shopping checklist with a counter
// and a reset button, and a "pick one" choice whose details change with the pick.
const widgets = (): Conversation =>
  parseConversation(JSON.parse(readFileSync(new URL('./fixtures/widgets.json', import.meta.url), 'utf8')));

const widgetBlocks = (c: Conversation) =>
  Object.values(c.nodes)
    .flatMap((n) => n.blocks)
    .filter((b): b is Extract<Block, { kind: 'widget' }> => b.kind === 'widget');

const CHOICE: WidgetNode[] = [
  { type: 'choice', id: 'mix', options: [{ label: 'Mild\n\nTomato first.' }, { label: 'Greek' }], selected: 0 },
  { type: 'markdown', text: 'Herbs:' },
  { type: 'switch', choice: 'mix', cases: [[{ type: 'markdown', text: 'Thyme' }], [{ type: 'markdown', text: 'Bay leaf' }]] },
];

describe('widget golden output', () => {
  it('HTML (chatgpt theme) and Markdown (github)', async () => {
    await expect(renderHtml(widgets(), { theme: 'chatgpt' })).toMatchFileSnapshot('golden/widgets.chatgpt.html');
    await expect(renderMarkdown(widgets(), { flavor: 'github' })).toMatchFileSnapshot('golden/widgets.github.md');
  });
});

describe('widget block', () => {
  it('validates, and the JSON export keeps the widget code verbatim', () => {
    const c = widgets();
    const [list, choice] = widgetBlocks(c);
    expect(list!.sourceFormat).toBe('chatgpt-widget');
    expect(list!.source).toMatch(/^\{@body const ingredients = [\s\S]*<\/box>$/);
    expect(choice!.source).toContain('DIL.useState("0")');
    const json = JSON.parse(renderJson(c));
    expect(widgetBlocks(json)).toEqual([list, choice]);
  });

  it('rejects malformed views', () => {
    const bad = { kind: 'widget', sourceFormat: 'x', source: '', view: [{ type: 'choice', id: 'c', options: [], selected: -2 }] };
    expect(BlockSchema.safeParse(bad).success).toBe(false);
    expect(BlockSchema.safeParse({ ...bad, view: [{ type: 'dial' }] }).success).toBe(false);
  });

  it('exposes the text of every state for search', () => {
    expect(widgetText(CHOICE)).toBe('Mild\n\nTomato first.\nGreek\nHerbs:\nThyme\nBay leaf');
  });
});

describe('widgetToMarkdown', () => {
  it('lists every option and every case, marking the starting pick', () => {
    expect(widgetToMarkdown(CHOICE)).toBe(
      [
        `*${WIDGET_STATIC_LABEL}*`,
        '- ◉ Mild\n\n  Tomato first.\n- ○ Greek',
        'Herbs:',
        '**For “Mild”:**',
        'Thyme',
        '**For “Greek”:**',
        'Bay leaf',
      ].join('\n\n'),
    );
  });

  it('keeps checkbox states, drops counters and buttons, and says what could not be read', () => {
    const view: WidgetNode[] = [
      { type: 'group', direction: 'row', children: [{ type: 'markdown', text: 'List' }, { type: 'counter' }] },
      { type: 'checkbox', label: 'Milk', checked: true },
      { type: 'checkbox', label: 'Eggs', checked: false },
      { type: 'reset', label: 'Clear' },
      { type: 'unsupported', text: 'Part of this widget could not be read' },
    ];
    expect(widgetToMarkdown(view)).toBe(`*${WIDGET_STATIC_LABEL}*\n\nList\n\n- [x] Milk\n- [ ] Eggs\n\n*[Part of this widget could not be read]*`);
  });
});

describe('widgetToHtml', () => {
  const ctx = { id: 'widget-7', markdown: (t: string) => `<p>${t}</p>\n` };

  it('makes clickable controls without scripts', () => {
    const html = widgetToHtml(CHOICE, 'code', ctx);
    expect(html).not.toMatch(/<script|\bon[a-z]+=/i);
    expect(html).toContain('<input type="radio" name="widget-7-c0" value="0" checked>');
    expect(html).toContain('<input type="radio" name="widget-7-c0" value="1">');
    // The picked option's case is shown by a rule scoped to this widget.
    expect(html).toContain('#widget-7:has(input[name="widget-7-c0"][value="1"]:checked) .w-case[data-case="widget-7-c0-1"]{display:block');
    expect(html).toContain(`<span class="on-print">${WIDGET_STATIC_LABEL}</span>`);
    expect(html).not.toContain('Widget code'); // shown only when a part could not be read
  });

  it('counts checkboxes, resets the form, and shows the code when a part is unreadable', () => {
    const view: WidgetNode[] = [
      { type: 'counter' },
      { type: 'checkbox', label: 'Milk', checked: true },
      { type: 'switch', choice: 'none', cases: [[{ type: 'markdown', text: 'first' }], [{ type: 'markdown', text: 'second' }]] },
      { type: 'reset', label: 'Clear <all>' },
      { type: 'unsupported', text: 'missing' },
    ];
    const html = widgetToHtml(view, 'x < y', ctx);
    expect(html).toContain('<input type="checkbox" checked><span class="w-label">Milk</span>');
    // The counter comes after the checkboxes: CSS counters only count what precedes them.
    expect(html.indexOf('w-counter')).toBeGreaterThan(html.indexOf('type="checkbox"'));
    expect(html).toContain('data-total="1"');
    expect(html).toContain('<button type="reset" class="w-reset">Clear &lt;all&gt;</button>');
    expect(html).toContain('<p>first</p>'); // an unknown choice falls back to its first case
    expect(html).not.toContain('second');
    expect(html).toContain('<summary>Widget code</summary>\n<pre><code>x &lt; y</code></pre>');
  });

  it('gives each widget in a document its own id', () => {
    const html = renderHtml(widgets());
    expect(html.match(/<form class="widget" id="widget-\d+"/g)).toEqual(['<form class="widget" id="widget-1"', '<form class="widget" id="widget-2"']);
    expect(html).not.toMatch(/<script/i);
  });
});
