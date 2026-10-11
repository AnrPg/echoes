import MarkdownIt from 'markdown-it';
import { z } from 'zod';
import type { Block, Conversation, Node } from '../model/schema.ts';
import type { Turn } from '../model/turns.ts';
import { TurnIndex, turnText, type SearchField } from './index.ts';
import { findMatches } from './normalize.ts';

/**
 * Turn-selection rules: what the rule builder's dropdowns produce, as plain, serializable data (hosts save them with
 * presets). Rules combine with `and`, `or` and `not`, and select turns of one path.
 *
 * Positions are 1-based turn indexes, as shown to the user. Turn 0 (context before the first question) is never
 * selected by a rule: whether it is exported is the turn definition's `hidden` toggle.
 *
 * @packageDocumentation
 */

export const ContentKindSchema = z.enum(['code', 'image', 'math', 'table', 'citation', 'attachment']);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const TextFieldSchema = z.enum(['question', 'answer', 'either']);
export const TextModeSchema = z.enum(['fuzzy', 'exact', 'regex']);

const position = z.number().int().min(1);

export type Rule =
  | { kind: 'and'; rules: Rule[] }
  | { kind: 'or'; rules: Rule[] }
  | { kind: 'not'; rule: Rule }
  | { kind: 'every'; n: number; start?: number | undefined }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'first'; n: number }
  | { kind: 'last'; n: number }
  | { kind: 'text'; field: z.infer<typeof TextFieldSchema>; query: string; mode: z.infer<typeof TextModeSchema>; caseSensitive?: boolean | undefined }
  | { kind: 'has'; content: ContentKind; negate?: boolean | undefined }
  | { kind: 'model'; model: string }
  | { kind: 'date'; from?: string | undefined; to?: string | undefined }
  | { kind: 'hasVersions' };

export const RuleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('and'), rules: z.array(RuleSchema) }),
    z.object({ kind: z.literal('or'), rules: z.array(RuleSchema) }),
    z.object({ kind: z.literal('not'), rule: RuleSchema }),
    /** Every `n`th turn counting from `start` (default 1): `{ n: 2 }` is turns 1, 3, 5… */
    z.object({ kind: z.literal('every'), n: position, start: position.optional() }),
    /** Turns `from` to `to`, both included. */
    z.object({ kind: z.literal('range'), from: position, to: position }),
    z.object({ kind: z.literal('first'), n: position }),
    z.object({ kind: z.literal('last'), n: position }),
    /**
     * `fuzzy`: every query term matches a term of the field, allowing typos and prefixes. `exact`: the normalized
     * query is a substring of the normalized field (good for code). `regex`: a JavaScript regular expression on the
     * raw text, case-insensitive unless `caseSensitive`.
     */
    z.object({
      kind: z.literal('text'),
      field: TextFieldSchema,
      query: z.string(),
      mode: TextModeSchema,
      caseSensitive: z.boolean().optional(),
    }),
    /** The turn has (or, with `negate`, has no) content of this kind. */
    z.object({ kind: z.literal('has'), content: ContentKindSchema, negate: z.boolean().optional() }),
    /** The conversation's model (per-message models are not in the model yet). Case-insensitive. */
    z.object({ kind: z.literal('model'), model: z.string().min(1) }),
    /** The question was asked in this range, both ends included. Turns with no time never match. */
    z.object({ kind: z.literal('date'), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }),
    /** The question or an answer of the turn has other versions (edits or regenerations). */
    z.object({ kind: z.literal('hasVersions') }),
  ]),
);

/** Thrown for a rule that is not valid: a bad shape, or a regex that does not compile. */
export class RuleError extends Error {
  override readonly name = 'RuleError';
}

/**
 * Check a rule (for example one loaded from settings) and compile its regexes once.
 *
 * @throws RuleError
 */
export function parseRule(input: unknown): Rule {
  const r = RuleSchema.safeParse(input);
  if (!r.success) throw new RuleError(r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
  visit(r.data, (rule) => {
    if (rule.kind === 'text' && rule.mode === 'regex') regexOf(rule);
  });
  return r.data;
}

function visit(rule: Rule, f: (r: Rule) => void): void {
  f(rule);
  if (rule.kind === 'and' || rule.kind === 'or') rule.rules.forEach((r) => visit(r, f));
  if (rule.kind === 'not') visit(rule.rule, f);
}

function regexOf(rule: Extract<Rule, { kind: 'text' }>): RegExp {
  try {
    return new RegExp(rule.query, rule.caseSensitive ? 'u' : 'iu');
  } catch (e) {
    throw new RuleError(`invalid regular expression /${rule.query}/: ${(e as Error).message}`);
  }
}

export interface SelectOptions {
  /** An index that already holds these turns under `conversation.id`. Built on the fly when absent. */
  index?: TurnIndex;
}

/**
 * The turns a rule selects, as their indexes in input order (turn 0 excluded). `and` of nothing selects every turn; `or` of nothing
 * selects none.
 *
 * @throws RuleError for an invalid rule.
 * @example
 * ```ts
 * const turns = buildTurns(nodesOf(conversation, activePath(conversation)));
 * selectTurns(conversation, turns, {
 *   kind: 'and',
 *   rules: [
 *     { kind: 'text', field: 'answer', query: 'integral', mode: 'fuzzy' },
 *     { kind: 'has', content: 'math' },
 *   ],
 * }); // [4, 7]
 * ```
 */
export function selectTurns(conversation: Conversation, turns: readonly Turn[], rule: Rule, options: SelectOptions = {}): number[] {
  const checked = parseRule(rule);
  let index = options.index;
  const ctx: Context = {
    conversation,
    turns,
    last: Math.max(0, ...turns.map((t) => t.index)),
    text: new Map(),
    fuzzy: (query, fields) => {
      if (!index) {
        index = new TurnIndex();
        index.addTurns(conversation.id, turns);
      }
      return new Set(index.search(query, { fields, conversationId: conversation.id }).map((h) => h.turn));
    },
    fuzzyCache: new Map(),
  };
  return turns.filter((t) => t.index >= 1 && matches(checked, t, ctx)).map((t) => t.index);
}

interface Context {
  conversation: Conversation;
  turns: readonly Turn[];
  last: number;
  text: Map<Turn, { question: string; answer: string }>;
  fuzzy: (query: string, fields: SearchField[]) => Set<number>;
  fuzzyCache: Map<Rule, Set<number>>;
}

function matches(rule: Rule, turn: Turn, ctx: Context): boolean {
  const i = turn.index;
  switch (rule.kind) {
    case 'and':
      return rule.rules.every((r) => matches(r, turn, ctx));
    case 'or':
      return rule.rules.some((r) => matches(r, turn, ctx));
    case 'not':
      return !matches(rule.rule, turn, ctx);
    case 'every':
      return i >= (rule.start ?? 1) && (i - (rule.start ?? 1)) % rule.n === 0;
    case 'range':
      return i >= rule.from && i <= rule.to;
    case 'first':
      return i <= rule.n;
    case 'last':
      return i > ctx.last - rule.n;
    case 'text':
      return textMatches(rule, turn, ctx);
    case 'has':
      return hasContent(turn, rule.content) !== (rule.negate ?? false);
    case 'model':
      return ctx.conversation.model?.toLowerCase() === rule.model.toLowerCase();
    case 'date': {
      const at = turn.question?.createdAt ?? turn.responses.find((n) => n.createdAt)?.createdAt;
      if (at === undefined) return false;
      const t = Date.parse(at);
      return (rule.from === undefined || t >= Date.parse(rule.from)) && (rule.to === undefined || t <= Date.parse(rule.to));
    }
    case 'hasVersions':
      return [turn.question, ...turn.responses].some((n) => n !== undefined && hasSiblings(ctx.conversation, n));
  }
}

function textMatches(rule: Extract<Rule, { kind: 'text' }>, turn: Turn, ctx: Context): boolean {
  const fields: SearchField[] = rule.field === 'either' ? ['question', 'answer'] : [rule.field];
  if (rule.mode === 'fuzzy') {
    let hits = ctx.fuzzyCache.get(rule);
    if (!hits) ctx.fuzzyCache.set(rule, (hits = ctx.fuzzy(rule.query, fields)));
    return hits.has(turn.index);
  }
  let text = ctx.text.get(turn);
  if (!text) ctx.text.set(turn, (text = turnText(turn)));
  const re = rule.mode === 'regex' ? regexOf(rule) : undefined;
  return fields.some((f) => (re ? re.test(text[f]) : findMatches(text[f], rule.query).length > 0));
}

function hasSiblings(conversation: Conversation, node: Node): boolean {
  return node.parentId !== null && (conversation.nodes[node.parentId]?.childIds.length ?? 0) > 1;
}

const md = new MarkdownIt('default', { html: false });

/**
 * What a turn contains. Code means fenced and indented blocks, inline code and tool code runs; image means uploads
 * and generated images; math means `\(…\)`, `\[…\]`, `$$…$$` or a LaTeX environment outside code.
 */
export function hasContent(turn: Turn, kind: ContentKind): boolean {
  const nodes = [turn.question, ...turn.responses].filter((n): n is Node => n !== undefined && !n.hidden);
  return nodes.some((n) => n.blocks.some((b) => blockHas(b, kind)));
}

function blockHas(b: Block, kind: ContentKind): boolean {
  switch (kind) {
    case 'code':
      return b.kind === 'code' || (b.kind === 'markdown' && markdownFeatures(b.text).code);
    case 'image':
      return b.kind === 'image' || (b.kind === 'markdown' && markdownFeatures(b.text).image);
    case 'math':
      return (b.kind === 'markdown' || b.kind === 'canvas') && markdownFeatures(b.text).math;
    case 'table':
      return (b.kind === 'markdown' || b.kind === 'canvas') && markdownFeatures(b.text).table;
    case 'citation':
      return b.kind === 'citation';
    case 'attachment':
      return b.kind === 'attachment';
  }
}

interface MarkdownFeatures {
  code: boolean;
  image: boolean;
  math: boolean;
  table: boolean;
}

const featureCache = new Map<string, MarkdownFeatures>();
const MATH = /\\\(|\\\[|\$\$|\\begin\{/;

function markdownFeatures(text: string): MarkdownFeatures {
  const cached = featureCache.get(text);
  if (cached) return cached;
  const f: MarkdownFeatures = { code: false, image: false, math: false, table: false };
  for (const t of md.parse(text, {})) {
    if (t.type === 'fence' || t.type === 'code_block') f.code = true;
    else if (t.type === 'table_open') f.table = true;
    else if (t.type === 'inline') {
      // Math is looked for in prose only; `\(` inside code is code. Escapes are read from the source line, since
      // markdown-it's text tokens have already turned `\(` into `(`.
      for (const c of t.children ?? []) {
        if (c.type === 'code_inline') f.code = true;
        else if (c.type === 'image') f.image = true;
      }
      if (MATH.test(t.content.replace(/`+[^`]*`+/g, ''))) f.math = true;
    }
  }
  if (featureCache.size > 2000) featureCache.clear();
  featureCache.set(text, f);
  return f;
}
