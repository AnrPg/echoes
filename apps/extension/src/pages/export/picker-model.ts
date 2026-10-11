// The turn picker's logic without the UI: the rule builder's rows as a core Rule, shift-click ranges, turn summaries
// and the version switcher. The picker (picker.tsx) only draws this.

import {
  getNode,
  hasContent,
  namedTraversals,
  pathThrough,
  previewOf,
  widgetText,
  type ContentKind,
  type Conversation,
  type Rule,
  type Turn,
} from '@echoes/core';

/** One row of the rule builder. `not` inverts it. Numbers are as typed; invalid rows are reported, not guessed. */
export type Condition = { not: boolean } & (
  | { type: 'every'; n: number; start: number }
  | { type: 'range'; from: number; to: number }
  | { type: 'first'; n: number }
  | { type: 'last'; n: number }
  | { type: 'text'; field: 'question' | 'answer' | 'either'; query: string; mode: 'fuzzy' | 'exact' | 'regex' }
  | { type: 'has'; content: ContentKind }
  | { type: 'model'; model: string }
  | { type: 'date'; from: string; to: string }
  | { type: 'hasVersions' }
);

export type ConditionType = Condition['type'];

export const CONDITION_LABELS: Record<ConditionType, string> = {
  text: 'Text contains',
  has: 'Has content',
  every: 'Every N turns',
  range: 'Turns from … to',
  first: 'First N turns',
  last: 'Last N turns',
  model: 'Model is',
  date: 'Asked between',
  hasVersions: 'Has other versions',
};

export const CONTENT_LABELS: Record<ContentKind, string> = {
  code: 'code',
  math: 'math',
  table: 'a table',
  image: 'a picture',
  citation: 'a citation',
  attachment: 'an attachment',
};

/** A new row of the given type with sensible starting values. */
export function newCondition(type: ConditionType): Condition {
  switch (type) {
    case 'every':
      return { not: false, type, n: 2, start: 1 };
    case 'range':
      return { not: false, type, from: 1, to: 5 };
    case 'first':
    case 'last':
      return { not: false, type, n: 5 };
    case 'text':
      return { not: false, type, field: 'either', query: '', mode: 'fuzzy' };
    case 'has':
      return { not: false, type, content: 'code' };
    case 'model':
      return { not: false, type, model: '' };
    case 'date':
      return { not: false, type, from: '', to: '' };
    case 'hasVersions':
      return { not: false, type };
  }
}

/**
 * The rows as one core rule, combined with `and` or `or`. Rows that are still empty (no text yet, no dates) are left
 * out, so the counter does not drop to zero while the user types. `undefined` when no row is complete.
 */
export function buildRule(combine: 'and' | 'or', rows: readonly Condition[]): Rule | undefined {
  const rules = rows.map(toRule).filter((r): r is Rule => r !== undefined);
  if (rules.length === 0) return undefined;
  return rules.length === 1 ? rules[0] : { kind: combine, rules };
}

function toRule(c: Condition): Rule | undefined {
  const r = base(c);
  return r && c.not ? { kind: 'not', rule: r } : r;
}

function base(c: Condition): Rule | undefined {
  const pos = (n: number) => Number.isInteger(n) && n >= 1;
  switch (c.type) {
    case 'every':
      return pos(c.n) && pos(c.start) ? { kind: 'every', n: c.n, start: c.start } : undefined;
    case 'range':
      return pos(c.from) && pos(c.to) ? { kind: 'range', from: Math.min(c.from, c.to), to: Math.max(c.from, c.to) } : undefined;
    case 'first':
    case 'last':
      return pos(c.n) ? { kind: c.type, n: c.n } : undefined;
    case 'text':
      return c.query.trim() ? { kind: 'text', field: c.field, query: c.query, mode: c.mode } : undefined;
    case 'has':
      return { kind: 'has', content: c.content };
    case 'model':
      return c.model.trim() ? { kind: 'model', model: c.model.trim() } : undefined;
    case 'date': {
      if (!c.from && !c.to) return undefined;
      // Date inputs give days; the rule takes instants. The "to" day is included whole.
      const r: Rule = { kind: 'date' };
      if (c.from) r.from = `${c.from}T00:00:00Z`;
      if (c.to) r.to = `${c.to}T23:59:59.999Z`;
      return r;
    }
    case 'hasVersions':
      return { kind: 'hasVersions' };
  }
}

/**
 * Shift-click: set every turn between the last clicked one and this one (both included) to `on`. `order` is the
 * selectable turn indexes as listed.
 */
export function selectRange(selected: ReadonlySet<number>, order: readonly number[], anchor: number, target: number, on: boolean): Set<number> {
  const a = order.indexOf(anchor);
  const b = order.indexOf(target);
  const next = new Set(selected);
  if (a === -1 || b === -1) {
    on ? next.add(target) : next.delete(target);
    return next;
  }
  for (const t of order.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(t) : next.delete(t);
  return next;
}

export function invert(selected: ReadonlySet<number>, all: readonly number[]): Set<number> {
  return new Set(all.filter((t) => !selected.has(t)));
}

/** What a turn row shows: the question's first words and content badges. */
export interface TurnSummary {
  index: number;
  question: string;
  answer: string;
  badges: string[];
  /** Other versions of this turn's question or answers. */
  versions: VersionChoice[];
}

export function summarize(c: Conversation, turn: Turn): TurnSummary {
  // The answer's own text, not its reasoning summary or tool output.
  const answerText = turn.responses
    .filter((n) => n.role === 'assistant' && !n.hidden)
    .flatMap((n) => n.blocks)
    .map((b) => (b.kind === 'markdown' ? b.text : b.kind === 'canvas' ? b.title : b.kind === 'widget' ? widgetText(b.view) : ''))
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
    .replace(/(\*\*|__|`+|^#+ )/gm, '') // bold and code marks, heading marks
    .replace(/\s+/g, ' ')
    .trim();
  const badges = (['code', 'math', 'table', 'image', 'attachment', 'citation'] as const).filter((k) => hasContent(turn, k));
  return {
    index: turn.index,
    question: turn.question ? previewOf(turn.question) : '',
    answer: [...answerText].length > 160 ? `${[...answerText].slice(0, 159).join('')}…` : answerText,
    badges,
    versions: versionChoices(c, turn),
  };
}

/** One version of a turn's question or answer, and the path that shows it. */
export interface VersionChoice {
  kind: 'question' | 'answer';
  version: number;
  of: number;
  /** True for the version on the path being shown. */
  current: boolean;
  /** The path through this version (and the active line below it, else the newest). */
  path: string[];
}

/** The versions of the question and first answer of a turn, for the preview's version switcher. */
export function versionChoices(c: Conversation, turn: Turn): VersionChoice[] {
  const out: VersionChoice[] = [];
  const firstAnswer = turn.responses.find((n) => n.role === 'assistant' || n.role === 'tool');
  for (const [kind, node] of [['question', turn.question], ['answer', firstAnswer]] as const) {
    if (!node || node.parentId === null) continue;
    const siblings = getNode(c, node.parentId).childIds;
    if (siblings.length < 2) continue;
    siblings.forEach((id, i) => out.push({ kind, version: i + 1, of: siblings.length, current: id === node.id, path: pathThrough(c, id) }));
  }
  return out;
}

/** The automatic branch name of a path, when it ends at a leaf (see core `namedTraversals`). */
export function branchNameOf(c: Conversation, path: readonly string[]): string | undefined {
  const leaf = path.at(-1);
  return namedTraversals(c).find((t) => t.leafId === leaf)?.name;
}
