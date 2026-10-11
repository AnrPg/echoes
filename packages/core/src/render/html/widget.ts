import { walkWidget, type WidgetNode } from '../../model/widget.ts';
import { WIDGET_STATIC_LABEL } from '../markdown/widget.ts';
import { escapeHtml } from './markdown.ts';

/** What {@link widgetToHtml} needs from the document. */
export interface WidgetHtmlContext {
  /** Element id for this widget, unique in the document (`widget-3`). */
  id: string;
  /** Markdown to HTML, as the document renders `markdown` blocks. */
  markdown(text: string): string;
}

/**
 * A widget as working HTML without any script: real checkboxes and radio buttons, a reset button (`<form>` reset),
 * a "checked / total" counter (CSS counters) and choice-dependent parts (CSS `:has()`), so it works in a file opened
 * from disk and under the document's script-free Content Security Policy. When printed it shows its current state
 * with a "Widget · shown static" label, and every case of every choice, the unpicked ones in small print.
 */
export function widgetToHtml(view: readonly WidgetNode[], source: string, ctx: WidgetHtmlContext): string {
  const w = new WidgetHtml(ctx);
  const body = w.nodes(view);
  const total = [...countable(view)].length;
  const parts = [
    `<form class="widget" id="${ctx.id}" aria-label="Interactive widget">`,
    `<p class="widget-tag"><span class="on-screen">Interactive widget</span><span class="on-print">${WIDGET_STATIC_LABEL}</span></p>`,
    body,
  ];
  // Counters come after the checkboxes in the document, as CSS counters only count what precedes them.
  if (w.counters) parts.push(`<span class="w-counter" data-total="${total}" aria-hidden="true"></span>`);
  parts.push('</form>');
  if (w.rules.length) parts.push(`<style>\n${w.rules.join('\n')}\n</style>`);
  if ([...walkWidget(view)].some((n) => n.type === 'unsupported')) {
    parts.push(`<details class="w-source"><summary>Widget code</summary>\n<pre><code>${escapeHtml(source)}</code></pre>\n</details>`);
  }
  return parts.join('\n');
}

/** Checkboxes outside any switch: the counter's total. */
function* countable(nodes: readonly WidgetNode[]): Generator<WidgetNode> {
  for (const n of nodes) {
    if (n.type === 'checkbox') yield n;
    else if (n.type === 'group') yield* countable(n.children);
  }
}

class WidgetHtml {
  readonly ctx: WidgetHtmlContext;
  readonly rules: string[] = [];
  counters = 0;
  /** Choice id → its radio group's name and option labels. */
  private readonly choices = new Map<string, { name: string; labels: string[] }>();

  constructor(ctx: WidgetHtmlContext) {
    this.ctx = ctx;
  }

  nodes(nodes: readonly WidgetNode[]): string {
    return nodes.map((n) => this.node(n)).filter((s) => s !== '').join('\n');
  }

  private node(n: WidgetNode): string {
    switch (n.type) {
      case 'markdown':
        return n.text.trim() ? this.ctx.markdown(n.text).trimEnd() : '';
      case 'group':
        return `<div class="w-group w-${n.direction === 'row' ? 'row' : 'col'}">\n${this.nodes(n.children)}\n</div>`;
      case 'checkbox':
        return `<label class="w-check"><input type="checkbox"${n.checked ? ' checked' : ''}><span class="w-label">${this.inline(n.label)}</span></label>`;
      case 'choice': {
        const name = `${this.ctx.id}-c${this.choices.size}`;
        this.choices.set(n.id, { name, labels: n.options.map((o) => o.label) });
        const options = n.options.map(
          (o, i) => `<label class="w-option"><input type="radio" name="${name}" value="${i}"${i === n.selected ? ' checked' : ''}><span class="w-label">${this.inline(o.label)}</span></label>`,
        );
        return `<fieldset class="w-choice">\n${options.join('\n')}\n</fieldset>`;
      }
      case 'switch': {
        const choice = this.choices.get(n.choice);
        if (!choice) return this.nodes(n.cases[0] ?? []); // no such choice: show the first case, as the static copy would
        const cases = n.cases.map((c, i) => {
          const key = `${choice.name}-${i}`;
          this.rules.push(`#${this.ctx.id}:has(input[name="${choice.name}"][value="${i}"]:checked) .w-case[data-case="${key}"]{display:block;font-size:inherit;color:inherit}`);
          const label = (choice.labels[i] ?? '').trim().split('\n')[0]!.trim() || `Option ${i + 1}`;
          return `<div class="w-case" data-case="${key}">\n<p class="w-case-label">For “${this.inline(label)}”:</p>\n${this.nodes(c)}\n</div>`;
        });
        return cases.join('\n');
      }
      case 'counter':
        this.counters++;
        return '';
      case 'reset':
        return `<button type="reset" class="w-reset">${escapeHtml(n.label || 'Reset')}</button>`;
      case 'unsupported':
        return `<p class="w-unsupported">[${escapeHtml(n.text)}]</p>`;
    }
  }

  /** Markdown for a label: one paragraph is unwrapped so it sits next to its checkbox. */
  private inline(text: string): string {
    const html = this.ctx.markdown(text).trim();
    const one = /^<p>([\s\S]*)<\/p>$/.exec(html);
    return one && !one[1]!.includes('<p>') ? one[1]! : html;
  }
}

/** Styles for widgets, shared by every theme. */
export const WIDGET_CSS = `
.widget{position:relative;counter-reset:wchecked;margin:1rem 0;padding:.75rem 1rem;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.widget-tag{margin:0 0 .5rem;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.widget .on-print,.widget .w-case-label{display:none}
.widget input[type=checkbox]:checked{counter-increment:wchecked}
.w-counter{position:absolute;top:.75rem;inset-inline-end:1rem;font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums}
.w-counter::before{content:counter(wchecked) "/" attr(data-total)}
.w-group{display:flex;flex-direction:column;gap:.35rem}
.w-row{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:.5rem 1rem}
.w-group>p,.w-case>p{margin:.25rem 0}
.widget hr{align-self:stretch;width:100%;border:0;border-top:1px solid var(--line);margin:.5rem 0}
.w-check,.w-option{display:flex;gap:.5rem;align-items:baseline;cursor:pointer}
.w-check input,.w-option input{flex:none;margin:0;transform:translateY(.1em)}
.w-check input:checked+.w-label{text-decoration:line-through;color:var(--muted)}
.w-label>p{margin:0}
.w-label>p+p{color:var(--muted);font-size:.9em}
.w-choice{border:0;padding:0;margin:.25rem 0;display:flex;flex-direction:column;gap:.35rem}
.w-case{display:none}
.w-reset{align-self:flex-end;font:inherit;font-size:.85rem;padding:.25rem .75rem;border:1px solid var(--line);border-radius:999px;background:transparent;color:inherit;cursor:pointer}
.w-unsupported{color:var(--muted);font-style:italic}
.w-source>summary{cursor:pointer;font-size:.8rem;color:var(--muted)}
@media print{
  .widget{break-inside:avoid}
  .widget .on-screen,.w-reset,.w-counter,.w-source{display:none}
  .widget .on-print{display:inline}
  .widget .w-case-label{display:block;font-weight:600}
  .w-case{display:block;font-size:.85em;color:var(--muted)}
}
`;
