import { z } from 'zod';

/**
 * Interactive widgets: small apps a provider draws inside an answer (a shopping checklist, a "pick one" choice whose
 * details change with the pick). The provider's own widget code is kept verbatim in the block's `source`; adapters
 * also read it into a {@link WidgetNode} tree, which is provider-neutral and holds no code: only text, the controls,
 * their starting state, and which parts change with which choice. Renderers draw that tree: clickable in HTML,
 * static in Markdown and print.
 *
 * @packageDocumentation
 */

/** One part of a widget. */
export type WidgetNode =
  /** Static content, as Markdown (the same flavor as a `markdown` block). */
  | { type: 'markdown'; text: string }
  /** A box of parts laid out in a column or a row. */
  | { type: 'group'; direction: 'column' | 'row'; children: WidgetNode[] }
  /** A checkbox. `label` is Markdown. `checked` is the starting state. */
  | { type: 'checkbox'; label: string; checked: boolean }
  /**
   * Pick one of several options (radio buttons). `id` is unique within the widget; `switch` parts refer to it.
   * `selected` is the starting option's index, or -1 when none is picked. Option labels are Markdown.
   */
  | { type: 'choice'; id: string; options: { label: string }[]; selected: number }
  /** Content that depends on a choice: `cases[i]` is shown while option `i` is picked. */
  | { type: 'switch'; choice: string; cases: WidgetNode[][] }
  /** "checked / total" for the widget's checkboxes. */
  | { type: 'counter' }
  /** A button that puts every control back to its starting state. */
  | { type: 'reset'; label: string }
  /** A part the adapter could not read. `text` says what is missing; the code is still in `source`. */
  | { type: 'unsupported'; text: string }
  /**
   * A small web app: an HTML page with its own scripts (ChatGPT's "app blocks"). The HTML export runs it sandboxed,
   * with no network; Markdown and print show it static. `html` is the page's content as the provider gave it.
   */
  | { type: 'app'; title: string; html: string };

export type WidgetNodeType = WidgetNode['type'];

export const WidgetNodeSchema: z.ZodType<WidgetNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('markdown'), text: z.string() }),
    z.object({ type: z.literal('group'), direction: z.enum(['column', 'row']), children: z.array(WidgetNodeSchema) }),
    z.object({ type: z.literal('checkbox'), label: z.string(), checked: z.boolean() }),
    z.object({
      type: z.literal('choice'),
      id: z.string().min(1),
      options: z.array(z.object({ label: z.string() })),
      selected: z.number().int().min(-1),
    }),
    z.object({ type: z.literal('switch'), choice: z.string().min(1), cases: z.array(z.array(WidgetNodeSchema)) }),
    z.object({ type: z.literal('counter') }),
    z.object({ type: z.literal('reset'), label: z.string() }),
    z.object({ type: z.literal('unsupported'), text: z.string() }),
    z.object({ type: z.literal('app'), title: z.string(), html: z.string() }),
  ]),
);

/** Every node of a widget tree, depth first, including the parts of every case of every switch. */
export function* walkWidget(nodes: readonly WidgetNode[]): Generator<WidgetNode> {
  for (const n of nodes) {
    yield n;
    if (n.type === 'group') yield* walkWidget(n.children);
    else if (n.type === 'switch') for (const c of n.cases) yield* walkWidget(c);
  }
}

/**
 * The text a reader can see in a widget, in every state: labels, options, and every case of every switch. For
 * search and comparisons, not for display.
 *
 * @example
 * ```ts
 * widgetText([{ type: 'checkbox', label: 'Milk', checked: false }]); // 'Milk'
 * ```
 */
export function widgetText(nodes: readonly WidgetNode[]): string {
  const out: string[] = [];
  for (const n of walkWidget(nodes)) {
    if (n.type === 'markdown' || n.type === 'unsupported') out.push(n.text);
    else if (n.type === 'checkbox' || n.type === 'reset') out.push(n.label);
    else if (n.type === 'choice') out.push(...n.options.map((o) => o.label));
    else if (n.type === 'app') out.push(n.title, visibleText(n.html));
  }
  return out.filter((t) => t.trim() !== '').join('\n');
}

/** The text an HTML page shows before any script runs: tags, scripts and styles removed, entities for `<>&"'` and spaces decoded. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' })[e]!)
    .replace(/\s+/g, ' ')
    .trim();
}
