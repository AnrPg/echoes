import type { WidgetNode } from '../../model/widget.ts';

/** The line Markdown and print exports put above a widget. */
export const WIDGET_STATIC_LABEL = 'Widget · shown static';

/**
 * A widget as static Markdown (the `commonmark` source flavor; renderers convert it like any `markdown` block):
 * checkboxes as task items in their starting state, a choice as a list marking the picked option (◉) and the
 * others (○), and every case of every switch under the option it belongs to, so nothing hidden behind a click is
 * lost. Counters and reset buttons are left out; they mean nothing on paper.
 *
 * @example
 * ```ts
 * widgetToMarkdown([{ type: 'checkbox', label: 'Milk', checked: false }]);
 * // '*Widget · shown static*\n\n- [ ] Milk'
 * ```
 */
export function widgetToMarkdown(view: readonly WidgetNode[]): string {
  const choices = new Map<string, Extract<WidgetNode, { type: 'choice' }>>();
  const blocks: Part[] = [{ text: `*${WIDGET_STATIC_LABEL}*` }];
  collect(view, blocks, choices);
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) out += b.item && blocks[i - 1]!.item ? '\n' : '\n\n';
    out += b.text;
  });
  return out;
}

interface Part {
  text: string;
  /** A list item: joined to the item before it with a single line break. */
  item?: boolean;
}

function collect(nodes: readonly WidgetNode[], out: Part[], choices: Map<string, Extract<WidgetNode, { type: 'choice' }>>): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'markdown':
        if (n.text.trim()) out.push({ text: n.text.trim() });
        break;
      case 'group':
        collect(n.children, out, choices);
        break;
      case 'checkbox':
        out.push({ text: item(`[${n.checked ? 'x' : ' '}] `, n.label), item: true });
        break;
      case 'choice':
        choices.set(n.id, n);
        n.options.forEach((o, i) => out.push({ text: item(i === n.selected ? '◉ ' : '○ ', o.label), item: true }));
        break;
      case 'switch': {
        const choice = choices.get(n.choice);
        n.cases.forEach((c, i) => {
          const inner: Part[] = [];
          collect(c, inner, choices);
          if (!inner.length) return;
          const label = firstLine(choice?.options[i]?.label ?? '') || `Option ${i + 1}`;
          out.push({ text: `**For “${label}”:**` }, ...inner);
        });
        break;
      }
      case 'unsupported':
        out.push({ text: `*[${n.text}]*` });
        break;
      case 'counter':
      case 'reset':
        break;
    }
  }
}

/** `- <mark><label>`, with the label's later lines indented under the item. */
function item(mark: string, label: string): string {
  const lines = label.trim().split('\n');
  return `- ${mark}${lines.map((l, i) => (i === 0 || l === '' ? l : `  ${l}`)).join('\n')}`;
}

function firstLine(markdown: string): string {
  return (markdown.trim().split('\n')[0] ?? '').trim();
}
