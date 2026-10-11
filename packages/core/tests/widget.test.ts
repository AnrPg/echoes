import { createHash } from 'node:crypto';
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
import { sha256Base64 } from '../src/render/html/sha256.ts';

// Widgets the ChatGPT adapter read from a real chat's raw API data (2026-10-11): a shopping checklist with a counter
// and a reset button, two "pick one" choices whose details change with the pick, and a widget app (HTML + script).
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
    const [list, choice, , app] = widgetBlocks(c);
    expect(list!.sourceFormat).toBe('chatgpt-widget');
    expect(list!.source).toMatch(/^\{@body const groups=\[[\s\S]*<\/box>$/);
    expect(choice!.source).toContain('DIL.useState("1")');
    const json = JSON.parse(renderJson(c));
    expect(app!.source).toBe((app!.view[0] as { html: string }).html);
    expect(widgetBlocks(json)).toEqual(widgetBlocks(c));
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
    expect(html.match(/<form class="widget" id="widget-\d+"/g)).toEqual(['<form class="widget" id="widget-1"', '<form class="widget" id="widget-2"', '<form class="widget" id="widget-3"', '<form class="widget" id="widget-4"']);
  });
});

describe('widget apps', () => {
  const app = (html: string): WidgetNode[] => [{ type: 'app', title: 'Calc', html }];
  const HTML = '<div class="grid sm:grid-cols-3 gap-3 bg-[var(--viz-card)] hover:bg-red-500"><button id="b">Run</button>\n<script>document.getElementById("b").textContent = "ok";</script></div>';

  it('run sandboxed: only their own scripts, allowed by hash in the page policy, and no network', () => {
    const c = widgets();
    const html = renderHtml(c);
    const csp = /content="(default-src[^"]*)"/.exec(html)![1]!;
    expect(csp).toMatch(/^default-src 'none'; style-src 'unsafe-inline'; img-src \* data: blob:; font-src data:; script-src( 'sha256-[A-Za-z0-9+/=]+'){3}$/);
    // The page script that sizes the frame, the app's own script, and the frame's size reporter.
    const [list] = widgetBlocks(c).filter((b) => b.sourceFormat === 'chatgpt-app-block');
    expect(list).toBeDefined();
    const appScript = /<script>([\s\S]*?)<\/script>/.exec(list!.source)![1]!;
    expect(csp).toContain(`'sha256-${createHash('sha256').update(appScript).digest('base64')}'`);
    expect(html).toContain('<iframe class="w-app" title="Live Code Widget" sandbox="allow-scripts" srcdoc="');
    expect(html).not.toContain('allow-same-origin');
    expect(html.match(/<script>/g)).toHaveLength(1); // the page's own resize helper; the app's scripts are inside srcdoc
  });

  it('pages without apps keep the script-free policy', () => {
    const c = widgets();
    delete c.nodes['a3'];
    delete c.nodes['q3'];
    c.nodes['a2']!.childIds = [];
    c.activeLeafId = 'a2';
    const html = renderHtml(c);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; img-src * data: blob:; font-src data:">`);
    expect(html).not.toMatch(/<script/);
  });

  it('style the classes an app uses, from a small Tailwind subset', () => {
    const scripts: string[] = [];
    const html = widgetToHtml(app(HTML), HTML, { id: 'widget-1', markdown: (t) => t, scripts });
    expect(scripts[0]).toBe('document.getElementById("b").textContent = "ok";');
    const srcdoc = /srcdoc="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    expect(srcdoc).toContain('.grid{display:grid}');
    expect(srcdoc).toContain('.gap-3{gap:0.75rem}');
    expect(srcdoc).toContain('.bg-\\[var\\(--viz-card\\)\\]{background-color:var(--viz-card)}');
    expect(srcdoc).toContain('@media (min-width:640px){.sm\\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}}');
    expect(srcdoc).not.toContain('.hover'); // state variants are left out
  });

  it('show their title, a note and their code in Markdown', () => {
    expect(widgetToMarkdown(app('<p>x</p>'))).toBe(
      `*${WIDGET_STATIC_LABEL}*\n\n**Calc**\n\n*This widget is a small app: open the HTML export to use it. Its code:*\n\n\`\`\`html\n<p>x</p>\n\`\`\``,
    );
    expect(widgetText(app(HTML))).toBe('Calc\nRun');
  });

  it('hash scripts as browsers do', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(64), 'Ελληνικά 🎉\n'.repeat(30)]) {
      expect(sha256Base64(s)).toBe(createHash('sha256').update(s).digest('base64'));
    }
    expect(sha256Base64('a\r\nb\rc')).toBe(createHash('sha256').update('a\nb\nc').digest('base64'));
  });
});
