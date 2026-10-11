import MiniSearch, { type SearchResult } from 'minisearch';
import type { Block, Node } from '../model/schema.ts';
import type { Turn } from '../model/turns.ts';
import { tokenize } from './tokenize.ts';

/**
 * Fuzzy, typo-tolerant full-text search over turns, built on MiniSearch. Terms come from {@link tokenize}, so the
 * index and the query share one normalization (case, accents, σ/ς, CJK pairs). Code and LaTeX source are searched
 * as written: the text of a turn is its raw Markdown and code, not rendered output.
 *
 * @packageDocumentation
 */

/** The searchable parts of a turn. */
export type SearchField = 'question' | 'answer';
export const SEARCH_FIELDS: readonly SearchField[] = ['question', 'answer'];

/**
 * Version of the index format: tokenizer, normalization and fields. A stored index with another version must be
 * rebuilt (see {@link TurnIndex.load}).
 */
export const SEARCH_INDEX_VERSION = 1;

/** One indexed turn. `id` is unique across the index: use {@link turnDocId}. */
export interface TurnDoc {
  id: string;
  conversationId: string;
  turn: number;
  question: string;
  answer: string;
}

/** One search hit, best first. */
export interface TurnHit {
  conversationId: string;
  turn: number;
  score: number;
  /** Indexed terms that matched (after normalization and typo correction), for highlighting. */
  terms: string[];
}

export interface TurnSearchOptions {
  /** Search only these fields. Default: both. */
  fields?: readonly SearchField[];
  /** `fuzzy` (default) allows typos and prefixes; `exact` matches whole normalized terms only. */
  mode?: 'fuzzy' | 'exact';
  /** `and` (default): every query term must match. `or`: any term. */
  combine?: 'and' | 'or';
  /** Only hits in this conversation. */
  conversationId?: string;
}

/** The id of a turn's document: `<conversationId>#<turn index>`. */
export function turnDocId(conversationId: string, turn: number): string {
  return `${conversationId}#${turn}`;
}

/**
 * The text a turn is searched by. Hidden nodes (memory, custom instructions) are left out. The question field is the
 * user node; the answer field is everything after it: Markdown, code, canvas and tool output text, and reasoning
 * summaries.
 */
export function turnText(turn: Turn): { question: string; answer: string } {
  const text = (n: Node | undefined) => (n && !n.hidden ? n.blocks.map(blockText).filter(Boolean).join('\n') : '');
  return { question: text(turn.question), answer: turn.responses.map(text).filter(Boolean).join('\n') };
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'markdown':
    case 'code':
    case 'toolOutput':
    case 'canvas':
      return b.kind === 'canvas' ? `${b.title}\n${b.text}` : b.text;
    case 'reasoning':
      return b.summary;
    case 'citation':
      return b.title ?? '';
    default:
      return '';
  }
}

/**
 * Typos allowed per term (edit distance), by length: none up to 3 characters, 1 for 4 or 5, then 2. Swapped letters
 * cost two edits, so a 6-letter word already allows them (`pyhton` finds `python`).
 */
export function typoBudget(term: string): number {
  const n = [...term].length;
  return n <= 3 ? 0 : n <= 5 ? 1 : 2;
}

const terms = (text: string): string[] => tokenize(text).map((t) => t.term);

function miniSearchOptions() {
  return {
    idField: 'id',
    fields: [...SEARCH_FIELDS],
    storeFields: ['conversationId', 'turn'],
    tokenize: terms,
    // Terms are already normalized by `tokenize`.
    processTerm: (term: string) => term,
  };
}

/**
 * A search index over turns of one or many conversations. Add turns with {@link TurnIndex.addTurns}; persist it with
 * {@link TurnIndex.toJSON} (for example in a `Store`) and restore it with {@link TurnIndex.load}.
 *
 * @example
 * ```ts
 * const index = new TurnIndex();
 * index.addTurns(conversation.id, buildTurns(nodesOf(conversation, activePath(conversation))));
 * index.search('pythagorean theorm'); // typo tolerated: [{ conversationId, turn: 3, score, terms: ['pythagorean', 'theorem'] }]
 * ```
 */
export class TurnIndex {
  readonly #mini: MiniSearch<TurnDoc>;

  constructor(mini?: MiniSearch<TurnDoc>) {
    this.#mini = mini ?? new MiniSearch<TurnDoc>(miniSearchOptions());
  }

  /** Number of indexed turns. */
  get size(): number {
    return this.#mini.documentCount;
  }

  /** Index a conversation's turns, replacing any turns indexed before for the same conversation. */
  addTurns(conversationId: string, turns: readonly Turn[]): void {
    this.removeConversation(conversationId);
    this.#mini.addAll(turns.map((t) => ({ id: turnDocId(conversationId, t.index), conversationId, turn: t.index, ...turnText(t) })));
  }

  /** Remove every turn of a conversation. */
  removeConversation(conversationId: string): void {
    const ids: string[] = [];
    // MiniSearch has no "by field" lookup; stored fields give the conversation of each document.
    for (const hit of this.#mini.search(MiniSearch.wildcard, { filter: (r) => r['conversationId'] === conversationId })) ids.push(String(hit.id));
    this.#mini.discardAll(ids);
  }

  /**
   * Search turns. An empty or whitespace query returns nothing. Hits are ordered by score, ties by conversation id
   * and turn, so results are deterministic.
   */
  search(query: string, options: TurnSearchOptions = {}): TurnHit[] {
    if (terms(query).length === 0) return [];
    const fuzzy = options.mode !== 'exact';
    const results = this.#mini.search(query, {
      fields: [...(options.fields ?? SEARCH_FIELDS)],
      combineWith: options.combine === 'or' ? 'OR' : 'AND',
      fuzzy: fuzzy ? (term: string) => typoBudget(term) : false,
      // Prefix matching only for terms long enough to be meaningful, so "a" does not match everything.
      prefix: fuzzy ? (term: string) => [...term].length >= 3 : false,
      ...(options.conversationId === undefined ? {} : { filter: (r: SearchResult) => r['conversationId'] === options.conversationId }),
    });
    return results
      .map((r) => ({ conversationId: r['conversationId'] as string, turn: r['turn'] as number, score: r.score, terms: [...r.terms].sort() }))
      .sort((a, b) => b.score - a.score || (a.conversationId < b.conversationId ? -1 : a.conversationId > b.conversationId ? 1 : a.turn - b.turn));
  }

  /** Serializable index state, tagged with {@link SEARCH_INDEX_VERSION}. */
  toJSON(): { version: number; index: unknown } {
    return { version: SEARCH_INDEX_VERSION, index: this.#mini.toJSON() };
  }

  /**
   * Restore an index from {@link TurnIndex.toJSON} output. Returns undefined when the stored version differs, so
   * the host rebuilds the index from its conversations.
   */
  static load(json: { version: number; index: unknown }): TurnIndex | undefined {
    if (json.version !== SEARCH_INDEX_VERSION) return undefined;
    return new TurnIndex(MiniSearch.loadJS<TurnDoc>(json.index as Parameters<typeof MiniSearch.loadJS>[0], miniSearchOptions()));
  }
}
