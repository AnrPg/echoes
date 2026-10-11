// A widget block: the provider's code kept verbatim, plus a code-free view that renders clickable in HTML and
// static in Markdown.
// Run: node examples/widget.ts
import { BlockSchema, widgetText, widgetToHtml, widgetToMarkdown, type Block } from '@echoes/core';

export function main(): string[] {
  const block: Block = BlockSchema.parse({
    kind: 'widget',
    sourceFormat: 'chatgpt-widget',
    source: '{@body const [size,setSize] = DIL.useState("0")} <radio-group value={size}>…</radio-group>',
    view: [
      { type: 'choice', id: 'size', options: [{ label: 'Small' }, { label: 'Large' }], selected: 0 },
      { type: 'switch', choice: 'size', cases: [[{ type: 'markdown', text: '200 g' }], [{ type: 'markdown', text: '400 g' }]] },
      { type: 'checkbox', label: 'Add salt', checked: false },
    ],
  });
  if (block.kind !== 'widget') throw new Error('unreachable');

  const html = widgetToHtml(block.view, block.source, { id: 'widget-1', markdown: (text) => `<p>${text}</p>` });
  return [
    `search text: ${widgetText(block.view).replace(/\n/g, ' | ')}`,
    `html: ${html.match(/<input [^>]*>/g)!.length} inputs, ${html.includes('<script') ? 'with' : 'no'} scripts`,
    ...widgetToMarkdown(block.view).split('\n'),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
