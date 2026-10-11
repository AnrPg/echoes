/**
 * ChatGPT's layout markup. Some answers are not plain Markdown: the web app renders tags such as `<box>`, `<row>`,
 * `<text>`, `<badge>`, `<AsyncImage>`, `<Cite>` and `<Link>` as cards, and small widgets written with a template
 * syntax (`{@body const items = [...]}`, `{#each items as item}`, `<checkbox>`) as interactive lists. Left as is, the
 * tags break Markdown (an HTML block swallows the section) and show as text in HTML.
 *
 * {@link convertLayoutMarkup} turns that markup into plain Markdown. Everything here comes from an export of a real
 * chat (2026-10-11), seen as text only: the raw message JSON has not been captured yet, so how `ref` and
 * `{turn…search….url.uri}` values resolve to URLs is unknown. They are left unresolved unless the caller passes a
 * {@link LayoutResolver}.
 *
 * Rules, by tag:
 *
 * - containers (`box`, `row`, `grid`, `grid-item`, `radio-group`, …) become paragraph breaks;
 * - `divider` becomes a thematic break;
 * - `title` becomes a bold line, `caption` an italic line, `badge` bold text, `text` and `Entity` their content;
 * - `AsyncImage` becomes an image when its source is known, else an "Image: …" note with its search query;
 * - `Link` becomes a link when its URL is known, else its text; `Cite` becomes nothing (the cited URLs are already
 *   listed after the answer);
 * - `checkbox` becomes a task list item, `radio` a list item; `icon` and `button` are dropped.
 *
 * Widget templates are expanded without running any code: `{@body const x = <literal>}` declarations are read with a
 * literal parser (arrays, objects, strings, numbers), `useState(<literal>)` binds its initial value, `{#each}` repeats
 * over lists, `{#if}` picks a branch, and `{name.path}` is substituted. The expressions understood are paths
 * (`a.b[0]`, `a[b]`), `.length`, `Number(…)` and `String(…)`; anything else (function calls, arithmetic) is dropped.
 * Text showing live widget state (a "0/12" counter) is dropped too. A list that cannot be read becomes one note.
 *
 * Fenced code blocks, inline code and math are never touched.
 *
 * @packageDocumentation
 */

import type { WidgetNode } from '@echoes/core';

const CONTAINERS = new Set(['box', 'row', 'grid', 'grid-item', 'radio-group', 'card', 'stack', 'col', 'column']);
/** Tags this module converts. Other tags (real HTML in an answer) are left alone. */
const KNOWN = new Set([
  ...CONTAINERS,
  'divider',
  'title',
  'caption',
  'badge',
  'text',
  'Entity',
  'AsyncImage',
  'Link',
  'Cite',
  'checkbox',
  'radio',
  'icon',
  'button',
]);

/** Quick test: does this text use the layout markup at all? Tags that also read as prose (`<text>`) do not count. */
const LAYOUT_HINT = /<(?:box|row|grid|AsyncImage|badge|divider|Cite|Entity)\b|\{@body\b|\{#each\b/;

export const INTERACTIVE_NOTE = '*[Interactive element: not exported]*';

export interface LayoutResolver {
  /** The URL of an image named by `ref` (e.g. `turn813304image1`), if known. */
  imageRef?(ref: string): string | undefined;
  /** The URL an expression such as `turn202216search9.url.uri` stands for, if known. */
  urlExpr?(expr: string): string | undefined;
}

export interface LayoutResult {
  markdown: string;
  /** Images shown only by a search query or an unresolved ref: the web app found them live. */
  unresolvedImages: number;
  /** Widget lists whose data could not be read. */
  unreadableWidgets: number;
}

/** Convert ChatGPT's layout markup in `text` to Markdown. Text without it comes back unchanged. */
export function convertLayoutMarkup(text: string, resolver: LayoutResolver = {}): LayoutResult {
  const result: LayoutResult = { markdown: text, unresolvedImages: 0, unreadableWidgets: 0 };
  if (!LAYOUT_HINT.test(text)) return result;
  const converter = new Converter(resolver, result);
  const out = splitProtected(text).map((seg) => (seg.keep ? seg.text : tidy(converter.run(seg.text))));
  result.markdown = out.join('').trim();
  return result;
}

/** Name of ChatGPT's widget language in a `widget` block's `sourceFormat`. */
export const WIDGET_SOURCE_FORMAT = 'chatgpt-widget';

/** A piece of an answer: Markdown, or an interactive widget with its code and a code-free reading of it. */
export type LayoutSegment = { kind: 'markdown'; text: string } | { kind: 'widget'; source: string; view: WidgetNode[] };

export interface LayoutSegments {
  segments: LayoutSegment[];
  unresolvedImages: number;
  /** Widget parts whose data could not be read (each is an `unsupported` part of its widget). */
  unreadableWidgets: number;
}

/**
 * Like {@link convertLayoutMarkup}, but interactive widgets come out as their own segments instead of a static
 * copy: `source` is the widget's code exactly as written (its `{@body …}` declarations and its element), `view` is
 * the widget read without running any code (see `WidgetNode` in `@echoes/core`). Text between widgets is converted
 * to Markdown as {@link convertLayoutMarkup} does.
 *
 * A widget is an element (or `{#each}` / `{#if}` block) with a control in it (`checkbox`, `radio-group`, `radio`,
 * `button`) or one that reads `useState` values, together with the `{@body}` declarations right before it.
 */
export function splitLayoutMarkup(text: string, resolver: LayoutResolver = {}): LayoutSegments {
  const result: LayoutResult = { markdown: '', unresolvedImages: 0, unreadableWidgets: 0 };
  if (!LAYOUT_HINT.test(text)) return { segments: text === '' ? [] : [{ kind: 'markdown', text }], unresolvedImages: 0, unreadableWidgets: 0 };
  const converter = new Converter(resolver, result);
  const segments: LayoutSegment[] = [];
  let md = '';
  const flush = () => {
    const t = md.trim();
    if (t) segments.push({ kind: 'markdown', text: t });
    md = '';
  };
  for (const seg of splitProtected(text)) {
    if (seg.keep) {
      md += seg.text;
      continue;
    }
    for (const part of converter.segments(seg.text)) {
      if (part.kind === 'markdown') md += part.text;
      else {
        flush();
        segments.push(part);
      }
    }
  }
  flush();
  return { segments, unresolvedImages: result.unresolvedImages, unreadableWidgets: result.unreadableWidgets };
}

// ---------------------------------------------------------------------------------------------------------------
// Protected regions

interface Segment {
  keep: boolean;
  text: string;
}

/** Split off fenced code blocks and display math so they pass through untouched. */
function splitProtected(text: string): Segment[] {
  const out: Segment[] = [];
  const region = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[`~]*[ \t]*$|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/gm;
  let last = 0;
  for (const m of text.matchAll(region)) {
    if (m.index > last) out.push({ keep: false, text: text.slice(last, m.index) });
    out.push({ keep: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ keep: false, text: text.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing: a forgiving reader for tags and template blocks. Anything it does not recognize stays text.

type Node = (
  | { t: 'text'; text: string }
  | { t: 'el'; name: string; attrs: Record<string, Attr>; children: Node[] }
  | { t: 'body'; source: string }
  | { t: 'each'; expr: string; item: string; index?: string; children: Node[] }
  | { t: 'if'; expr: string; then: Node[]; else: Node[] }
  | { t: 'expr'; expr: string }
) & {
  /** Where the node starts and ends in the parsed text (not set on text nodes). */
  span?: [number, number];
};

type Attr = { kind: 'string'; value: string } | { kind: 'expr'; value: string } | { kind: 'flag' };

class Parser {
  i = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  parse(): Node[] {
    return this.nodes(undefined).nodes;
  }

  /** Read nodes until `</stop>`, or `{/stop}` when `stop` starts with `/`; the closer is consumed. */
  private nodes(stop: string | undefined): { nodes: Node[]; ended: string | undefined } {
    const nodes: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) nodes.push({ t: 'text', text });
      text = '';
    };
    const spanned = (n: Node, at: number) => {
      n.span = [at, this.i];
      nodes.push(n);
    };
    while (this.i < this.s.length) {
      const c = this.s[this.i]!;
      const at = this.i;
      if (c === '`' || (c === '\\' && this.s[this.i + 1] === '(')) {
        const end = c === '`' ? this.codeSpanEnd() : this.s.indexOf('\\)', this.i + 2) + 2;
        if (end > this.i + 1) {
          text += this.s.slice(this.i, end);
          this.i = end;
          continue;
        }
      }
      if (c === '<') {
        const close = /^<\/([A-Za-z][\w-]*)\s*>/.exec(this.s.slice(this.i));
        if (close && KNOWN.has(close[1]!)) {
          this.i += close[0].length;
          if (close[1] === stop) {
            flush();
            return { nodes, ended: stop };
          }
          continue; // a stray closing tag: drop it
        }
        const el = this.element();
        if (el) {
          flush();
          spanned(el, at);
          continue;
        }
      }
      if (c === '{' && (/^\{[@#:/][a-z]/.test(this.s.slice(this.i, this.i + 3)) || this.exprAllowedHere())) {
        const end = matchBrace(this.s, this.i);
        const inner = end > 0 ? this.s.slice(this.i + 1, end) : '';
        if (inner.startsWith('@body')) {
          flush();
          this.i = end + 1;
          spanned({ t: 'body', source: inner.slice(5).trim() }, at);
          continue;
        }
        const each = /^#each\s+([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*(?:\([^)]*\))?\s*$/.exec(inner);
        if (each) {
          flush();
          this.i = end + 1;
          const body = this.nodes('/each');
          const node: Node = { t: 'each', expr: each[1]!.trim(), item: each[2]!, children: body.nodes };
          if (each[3]) node.index = each[3];
          spanned(node, at);
          continue;
        }
        const iff = /^#if\s+([\s\S]+)$/.exec(inner);
        if (iff) {
          flush();
          this.i = end + 1;
          const then = this.nodes('/if');
          const other = then.ended === ':else' ? this.nodes('/if').nodes : [];
          spanned({ t: 'if', expr: iff[1]!.trim(), then: then.nodes, else: other }, at);
          continue;
        }
        const tmpl = /^([:/])(each|if|else)\b/.exec(inner);
        if (tmpl) {
          this.i = end + 1;
          const name = `${tmpl[1]}${tmpl[2]}`;
          if (stop && (name === stop || (stop === '/if' && name === ':else'))) {
            flush();
            return { nodes, ended: name };
          }
          continue;
        }
        if (end > 0 && this.exprAllowedHere() && isTemplateExpr(inner.trim())) {
          flush();
          this.i = end + 1;
          spanned({ t: 'expr', expr: inner.trim() }, at);
          continue;
        }
      }
      text += c;
      this.i++;
    }
    flush();
    return { nodes, ended: undefined };
  }

  /** End of the inline code span at `i`, or -1 if the backticks are unmatched. */
  private codeSpanEnd(): number {
    const run = /^`+/.exec(this.s.slice(this.i))![0];
    const end = this.s.indexOf(run, this.i + run.length);
    return end < 0 ? -1 : end + run.length;
  }

  /** `{` right after a letter, digit, `\`, `}`, `^` or `_` is LaTeX (`\frac{a}{b}`, `x^{2}`), not `{expr}`. */
  private exprAllowedHere(): boolean {
    const prev = this.s[this.i - 1];
    return prev === undefined || !/[\p{L}\p{N}\\}^_]/u.test(prev);
  }

  /** `<Name attr="x" attr={expr} flag>` with children, or `<Name …/>`. Undefined (nothing consumed) if not one. */
  private element(): Node | undefined {
    const start = this.i;
    const m = /^<([A-Za-z][\w-]*)/.exec(this.s.slice(this.i));
    if (!m || !KNOWN.has(m[1]!)) return undefined;
    const name = m[1]!;
    this.i += m[0].length;
    const attrs: Record<string, Attr> = {};
    const fail = () => {
      this.i = start;
      return undefined;
    };
    for (;;) {
      this.skipSpace();
      if (this.s.startsWith('/>', this.i)) {
        this.i += 2;
        return { t: 'el', name, attrs, children: [] };
      }
      if (this.s[this.i] === '>') {
        this.i++;
        return { t: 'el', name, attrs, children: this.nodes(name).nodes };
      }
      const a = /^([A-Za-z_][\w-]*)/.exec(this.s.slice(this.i));
      if (!a) return fail();
      this.i += a[0].length;
      this.skipSpace();
      if (this.s[this.i] !== '=') {
        attrs[a[1]!] = { kind: 'flag' };
        continue;
      }
      this.i++;
      this.skipSpace();
      const q = this.s[this.i];
      if (q === '"' || q === "'") {
        const end = this.s.indexOf(q, this.i + 1);
        if (end < 0) return fail();
        attrs[a[1]!] = { kind: 'string', value: this.s.slice(this.i + 1, end) };
        this.i = end + 1;
      } else if (q === '{') {
        const end = matchBrace(this.s, this.i);
        if (end < 0) return fail();
        attrs[a[1]!] = { kind: 'expr', value: this.s.slice(this.i + 1, end).trim() };
        this.i = end + 1;
      } else return fail();
    }
  }

  private skipSpace(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
}

/** A `{…}` holding an expression (`{x}`, `{item.title}`, `{a.reduce(…)}`), not a number or prose. */
function isTemplateExpr(inner: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\s*[.[(+\-*/?:=><!&|][\s\S]*)?$/.test(inner) && !inner.includes('\\');
}

/** Index of the `}` matching the `{` at `open`, skipping strings; -1 if none. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(s, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) return c === '}' ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function endOfString(s: string, start: number): number {
  const q = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === q) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Widget data: literals and a few expressions, read without running any code.

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

class Unreadable extends Error {}

interface Scope {
  values: Map<string, Value>;
  /** Names bound by `useState`: their value changes as the reader clicks, so it is not shown as text. */
  state: Set<string>;
  /** `useState` setter name → state name (`setChecked` → `checked`). */
  setters: Map<string, string>;
  /** Starting value of each `useState` name. */
  initial: Map<string, Value>;
}

function newScope(): Scope {
  return { values: new Map(), state: new Set(), setters: new Map(), initial: new Map() };
}

/** A scope for the inside of a loop or a case: own values, the same state bookkeeping. */
function childScope(scope: Scope): Scope {
  return { ...scope, values: new Map(scope.values) };
}

/**
 * Read `const name = <literal>` and `const [a, setA] = X.useState(<literal>)` declarations into `scope`. Stops at the
 * first declaration it cannot read; the names bound so far are kept.
 */
function readDeclarations(source: string, scope: Scope): void {
  const s = source;
  let i = 0;
  const space = () => {
    while (i < s.length && /[\s;,]/.test(s[i]!)) i++;
  };
  try {
    space();
    while (i < s.length) {
      const head = /^(?:const|let|var)\s+/.exec(s.slice(i));
      if (!head) return;
      i += head[0].length;
      const pair = /^\[\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\]\s*=\s*[\w$.]*useState\(/.exec(s.slice(i));
      if (pair) {
        i += pair[0].length;
        const r = new LiteralReader(s, i);
        const v = r.value();
        r.space();
        if (s[r.i] !== ')') return;
        i = r.i + 1;
        scope.values.set(pair[1]!, v);
        scope.state.add(pair[1]!);
        scope.initial.set(pair[1]!, v);
        if (pair[2]) scope.setters.set(pair[2], pair[1]!);
      } else {
        const one = /^([A-Za-z_$][\w$]*)\s*=\s*/.exec(s.slice(i));
        if (!one) return;
        i += one[0].length;
        const r = new LiteralReader(s, i);
        scope.values.set(one[1]!, r.value());
        i = r.i;
      }
      space();
    }
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
  }
}

class LiteralReader {
  readonly s: string;
  i: number;
  constructor(s: string, i: number) {
    this.s = s;
    this.i = i;
  }

  value(): Value {
    this.space();
    const c = this.s[this.i];
    if (c === '[') return this.array();
    if (c === '{') return this.object();
    if (c === '"' || c === "'" || c === '`') return this.string();
    const m = /^(-?\d+(?:\.\d+)?|true|false|null)(?![\w$])/.exec(this.s.slice(this.i));
    if (m) {
      this.i += m[0].length;
      return m[1] === 'true' ? true : m[1] === 'false' ? false : m[1] === 'null' ? null : Number(m[1]);
    }
    throw new Unreadable(`not a literal at ${this.s.slice(this.i, this.i + 20)}`);
  }

  private array(): Value[] {
    this.i++;
    const out: Value[] = [];
    for (;;) {
      this.space();
      if (this.s[this.i] === ']') {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.space();
      if (this.s[this.i] === ',') this.i++;
      else if (this.s[this.i] !== ']') throw new Unreadable('bad array');
    }
  }

  private object(): { [k: string]: Value } {
    this.i++;
    const out: { [k: string]: Value } = {};
    for (;;) {
      this.space();
      if (this.s[this.i] === '}') {
        this.i++;
        return out;
      }
      let key: string;
      const q = this.s[this.i];
      if (q === '"' || q === "'") key = this.string();
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
        if (!m) throw new Unreadable('bad key');
        key = m[0];
        this.i += key.length;
      }
      this.space();
      if (this.s[this.i] !== ':') throw new Unreadable('shorthand or computed property');
      this.i++;
      out[key] = this.value();
      this.space();
      if (this.s[this.i] === ',') this.i++;
      else if (this.s[this.i] !== '}') throw new Unreadable('bad object');
    }
  }

  private string(): string {
    const q = this.s[this.i]!;
    const end = endOfString(this.s, this.i);
    if (end < 0) throw new Unreadable('unterminated string');
    const raw = this.s.slice(this.i + 1, end);
    if (q === '`' && raw.includes('${')) throw new Unreadable('template string with code');
    this.i = end + 1;
    return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
      if (e.length > 1 && e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
      return e === 'n' ? '\n' : e === 't' ? '\t' : e;
    });
  }

  space(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
}

/**
 * Evaluate the small expression language widgets use for data: literals, names, `.key`, `[expr]`, `.length`,
 * `Number(expr)` and `String(expr)`. Undefined for anything else. `seen.usesState` is set when a `useState` name is
 * read.
 */
function evaluate(expr: string, scope: Scope, seen: { usesState: boolean } = { usesState: false }): Value | undefined {
  const r = new LiteralReader(expr, 0);
  const primary = (): Value | undefined => {
    r.space();
    const c = expr[r.i];
    if (c !== undefined && /[[{"'`\d-]/.test(c)) return r.value();
    const call = /^(Number|String)\s*\(/.exec(expr.slice(r.i));
    if (call) {
      r.i += call[0].length;
      const v = postfix(primary());
      r.space();
      if (expr[r.i] !== ')') throw new Unreadable('call with more than one argument');
      r.i++;
      if (v === undefined) return undefined;
      return call[1] === 'Number' ? Number(v) : String(v);
    }
    const name = /^[A-Za-z_$][\w$]*/.exec(expr.slice(r.i));
    if (!name || !scope.values.has(name[0])) throw new Unreadable('unknown name');
    r.i += name[0].length;
    if (scope.state.has(name[0])) seen.usesState = true;
    return scope.values.get(name[0]);
  };
  const postfix = (start: Value | undefined): Value | undefined => {
    let v = start;
    for (;;) {
      r.space();
      const c = expr[r.i];
      let key: string | number;
      if (c === '.') {
        const m = /^\.\s*([A-Za-z_$][\w$]*)(?!\s*\()/.exec(expr.slice(r.i));
        if (!m) throw new Unreadable('method call');
        r.i += m[0].length;
        key = m[1]!;
      } else if (c === '[') {
        r.i++;
        const k = postfix(primary());
        r.space();
        if (expr[r.i] !== ']') throw new Unreadable('bad index');
        r.i++;
        if (typeof k !== 'string' && typeof k !== 'number') return undefined;
        key = k;
      } else return v;
      if (key === 'length' && (Array.isArray(v) || typeof v === 'string')) v = v.length;
      else if (Array.isArray(v)) v = typeof key === 'number' || /^\d+$/.test(key) ? v[Number(key)] : undefined;
      else if (v !== null && v !== undefined && typeof v === 'object') v = v[String(key)];
      else v = undefined;
    }
  };
  try {
    const v = postfix(primary());
    r.space();
    return r.i === expr.length ? v : undefined;
  } catch (e) {
    if (e instanceof Unreadable) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering to Markdown

class Converter {
  readonly resolver: LayoutResolver;
  readonly result: LayoutResult;
  /** Put each `<text>` on its own line (inside a widget option: its name, then its description). */
  textOnOwnLine = false;
  constructor(resolver: LayoutResolver, result: LayoutResult) {
    this.resolver = resolver;
    this.result = result;
  }

  run(text: string): string {
    const scope = newScope();
    // Text outside any tag is ordinary Markdown and is kept exactly; only text inside the markup is re-indented.
    return new Parser(text)
      .parse()
      .map((n) => (n.t === 'text' ? n.text : this.node(n, scope)))
      .join('');
  }

  /** Like {@link run}, with widgets split out. Markdown parts are tidied but not trimmed. */
  segments(text: string): LayoutSegment[] {
    const scope = newScope();
    const out: LayoutSegment[] = [];
    let md = '';
    let declStart: number | undefined;
    for (const n of new Parser(text).parse()) {
      if (n.t === 'text') {
        md += n.text;
        if (n.text.trim()) declStart = undefined;
        continue;
      }
      if (n.t === 'body') {
        declStart ??= n.span![0];
        readDeclarations(n.source, scope);
        continue;
      }
      if (isWidget(n, scope)) {
        out.push({ kind: 'markdown', text: tidy(md) });
        md = '';
        const source = text.slice(declStart ?? n.span![0], n.span![1]);
        out.push({ kind: 'widget', source, view: new WidgetReader(this).read([n], scope) });
      } else md += this.node(n, scope);
      declStart = undefined;
    }
    out.push({ kind: 'markdown', text: tidy(md) });
    return out;
  }

  /** Static Markdown for nodes, tidied and trimmed. */
  markdown(nodes: Node[], scope: Scope): string {
    return tidy(this.nodes(nodes, scope)).trim();
  }

  nodes(nodes: Node[], scope: Scope): string {
    let out = '';
    for (const n of nodes) out += this.node(n, scope);
    return out;
  }

  node(n: Node, scope: Scope): string {
    switch (n.t) {
      case 'text':
        return dedent(n.text);
      case 'expr': {
        const seen = { usesState: false };
        const v = evaluate(n.expr, scope, seen);
        return !seen.usesState && (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
      }
      case 'body':
        readDeclarations(n.source, scope);
        return '';
      case 'each': {
        const list = evaluate(n.expr, scope);
        if (!Array.isArray(list)) {
          this.result.unreadableWidgets++;
          return `${BLOCK}${INTERACTIVE_NOTE}${BLOCK}`;
        }
        return list
          .map((item, i) => {
            const inner = childScope(scope);
            inner.values.set(n.item, item);
            if (n.index) inner.values.set(n.index, i);
            return this.nodes(n.children, inner);
          })
          .join('');
      }
      case 'if': {
        const v = evaluate(n.expr, scope);
        if (v === undefined) return this.nodes(n.then, scope); // unknown condition: show the main branch
        const truthy = Array.isArray(v) ? v.length > 0 : Boolean(v);
        return this.nodes(truthy ? n.then : n.else, scope);
      }
      case 'el':
        return this.element(n, scope);
    }
  }

  private element(n: Extract<Node, { t: 'el' }>, scope: Scope): string {
    const inner = () => oneLine(this.nodes(n.children, scope));
    const attr = (name: string): string | undefined => {
      const a = n.attrs[name];
      if (!a || a.kind === 'flag') return undefined;
      if (a.kind === 'string') return a.value;
      const v = evaluate(a.value, scope);
      return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
    };
    if (CONTAINERS.has(n.name)) {
      const body = this.nodes(n.children, scope);
      return body.trim() ? `${BLOCK}${body}${BLOCK}` : '';
    }
    switch (n.name) {
      case 'divider':
        return `${BLOCK}---${BLOCK}`;
      case 'title': {
        const t = inner();
        return t ? `${BLOCK}**${t}**${BLOCK}` : '';
      }
      case 'caption': {
        const t = inner();
        return t ? `${BLOCK}*${t}*${BLOCK}` : '';
      }
      case 'badge': {
        const t = inner();
        return t ? ` **${t}** ` : '';
      }
      case 'text': {
        // A text showing widget state ("3/12 checked") means nothing in a static copy.
        if (n.children.some((c) => c.t === 'expr' && dependsOnState(c.expr, scope))) return '';
        const t = this.nodes(n.children, scope).trim();
        return t.includes('\n') || this.textOnOwnLine ? `${BLOCK}${t}${BLOCK}` : ` ${t} `;
      }
      case 'Entity':
        return n.children.length ? inner() : (attr('value') ?? attr('name') ?? '');
      case 'AsyncImage': {
        const query = attr('query') ?? attr('alt');
        const ref = attr('ref');
        const url = attr('src') ?? attr('url') ?? (ref ? this.resolver.imageRef?.(ref) : undefined);
        if (url && /^https?:\/\//.test(url)) return `${BLOCK}![${escapeAlt(query ?? '')}](${url})${BLOCK}`;
        this.result.unresolvedImages++;
        return `${BLOCK}${query ? `*[Image: ${oneLine(query)}]*` : '*[Image]*'}${BLOCK}`;
      }
      case 'Link': {
        const label = inner();
        const a = n.attrs['url'] ?? n.attrs['href'];
        let url: string | undefined;
        if (a?.kind === 'string') url = a.value;
        else if (a?.kind === 'expr') {
          const v = evaluate(a.value, scope);
          url = typeof v === 'string' ? v : this.resolver.urlExpr?.(a.value);
        }
        if (url && /^https?:\/\//.test(url)) return `[${label || url}](${url})`;
        return label;
      }
      case 'checkbox':
        return `${BLOCK}${ITEM}- [ ] ${inner()}${BLOCK}`;
      case 'radio':
        return `${BLOCK}${ITEM}- ${inner()}${BLOCK}`;
      default: // Cite, icon, button
        return '';
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Widgets: read into a WidgetNode tree, without running any code

const CONTROLS = new Set(['checkbox', 'radio', 'radio-group', 'button']);

/** Does `n` hold a control, or read a `useState` value? */
function isWidget(n: Node, scope: Scope): boolean {
  return (n.t === 'el' && CONTROLS.has(n.name)) || hasControl(n) || mentions(n, scope.state).size > 0;
}

function hasControl(n: Node): boolean {
  return children(n).some((c) => (c.t === 'el' && CONTROLS.has(c.name)) || hasControl(c));
}

function children(n: Node): Node[] {
  if (n.t === 'el' || n.t === 'each') return n.children;
  if (n.t === 'if') return [...n.then, ...n.else];
  return [];
}

/** The names from `names` that the expressions in `n` (and below it) use. */
function mentions(n: Node, names: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  if (names.size === 0) return found;
  const visit = (m: Node) => {
    const exprs: string[] = [];
    if (m.t === 'expr' || m.t === 'each' || m.t === 'if') exprs.push(m.expr);
    if (m.t === 'el') for (const a of Object.values(m.attrs)) if (a.kind === 'expr') exprs.push(a.value);
    for (const e of exprs) for (const w of e.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []) if (names.has(w)) found.add(w);
    if (m.t === 'el' && (m.name === 'radio-group' || m.name === 'button')) return; // its own state, not content that depends on it
    for (const c of children(m)) visit(c);
  };
  visit(n);
  return found;
}

/** Turns a widget's nodes into a {@link WidgetNode} tree. One reader per widget. */
class WidgetReader {
  private readonly conv: Converter;
  /** `useState` names bound to a `radio-group`: name → that choice's option values. */
  private readonly choices = new Map<string, string[]>();
  constructor(conv: Converter) {
    this.conv = conv;
  }

  read(nodes: Node[], scope: Scope): WidgetNode[] {
    const out: WidgetNode[] = [];
    let plain: Node[] = [];
    const flush = () => {
      const text = this.conv.markdown(plain, scope);
      if (text) out.push({ type: 'markdown', text });
      plain = [];
    };
    for (const n of nodes) {
      if (n.t === 'body') {
        readDeclarations(n.source, scope);
        continue;
      }
      if (n.t === 'text' || !isWidget(n, scope)) {
        plain.push(n);
        continue;
      }
      flush();
      out.push(...this.node(n, scope));
    }
    flush();
    return out;
  }

  private node(n: Node, scope: Scope): WidgetNode[] {
    if (n.t === 'el' && n.name === 'radio-group') return [this.choice(n, scope)];
    // Content that changes with a choice: one case per option, each read with that option picked.
    const picked = [...mentions(n, scope.state)].find((s) => this.choices.has(s));
    if (picked && !(n.t === 'el' && CONTAINERS.has(n.name) && hasControl(n))) {
      const cases = this.choices.get(picked)!.map((value) => {
        const inner = childScope(scope);
        inner.values.set(picked, value);
        inner.state = new Set([...scope.state].filter((s) => s !== picked));
        return this.read([n], inner);
      });
      return [{ type: 'switch', choice: picked, cases }];
    }
    switch (n.t) {
      case 'each': {
        const list = evaluate(n.expr, scope);
        if (!Array.isArray(list)) {
          this.conv.result.unreadableWidgets++;
          return [{ type: 'unsupported', text: 'Part of this widget could not be read; its code is kept in the JSON export' }];
        }
        return list.flatMap((item, i) => {
          const inner = childScope(scope);
          inner.values.set(n.item, item);
          if (n.index) inner.values.set(n.index, i);
          return this.read(n.children, inner);
        });
      }
      case 'if': {
        const v = evaluate(n.expr, scope);
        const truthy = v === undefined || (Array.isArray(v) ? v.length > 0 : Boolean(v));
        return this.read(truthy ? n.then : n.else, scope);
      }
      case 'expr':
        return this.counter(n.expr, scope) ? [{ type: 'counter' }] : [];
      case 'el':
        break;
      default:
        return [];
    }
    if (CONTAINERS.has(n.name)) {
      const kids = this.read(n.children, scope);
      return kids.length ? [{ type: 'group', direction: n.name === 'row' ? 'row' : 'column', children: kids }] : [];
    }
    switch (n.name) {
      case 'checkbox': {
        const a = n.attrs['checked'];
        const checked = a?.kind === 'flag' || (a?.kind === 'expr' && evaluate(a.value, scope) === true);
        return [{ type: 'checkbox', label: this.conv.markdown(n.children, scope), checked }];
      }
      case 'radio':
        return [{ type: 'markdown', text: `- ${this.conv.markdown(n.children, scope)}` }]; // a radio outside a group
      case 'button': {
        const label = oneLine(this.conv.markdown(n.children, scope));
        return this.resets(n, scope) ? [{ type: 'reset', label }] : [];
      }
      case 'text': {
        // "3/12" next to a checklist; any other text showing live state means nothing in a copy.
        const exprs = n.children.filter((c): c is Extract<Node, { t: 'expr' }> => c.t === 'expr');
        return exprs.some((e) => this.counter(e.expr, scope)) ? [{ type: 'counter' }] : [];
      }
      default:
        return this.read(n.children, scope);
    }
  }

  private choice(n: Extract<Node, { t: 'el' }>, scope: Scope): WidgetNode {
    const options: { value: string; label: string }[] = [];
    const collect = (nodes: Node[], s: Scope) => {
      for (const c of nodes) {
        if (c.t === 'body') readDeclarations(c.source, s);
        else if (c.t === 'el' && c.name === 'radio') {
          const v = attrValue(c, 'value', s);
          this.conv.textOnOwnLine = true;
          const label = this.conv.markdown(c.children, s);
          this.conv.textOnOwnLine = false;
          options.push({ value: v ?? String(options.length), label });
        } else if (c.t === 'each') {
          const list = evaluate(c.expr, s);
          if (!Array.isArray(list)) {
            this.conv.result.unreadableWidgets++;
            continue;
          }
          list.forEach((item, i) => {
            const inner = childScope(s);
            inner.values.set(c.item, item);
            if (c.index) inner.values.set(c.index, i);
            collect(c.children, inner);
          });
        } else if (c.t === 'el' || c.t === 'if') collect(children(c), s);
      }
    };
    collect(n.children, scope);
    const bound = n.attrs['value'];
    const name = bound?.kind === 'expr' && /^[A-Za-z_$][\w$]*$/.test(bound.value) ? bound.value : undefined;
    const start = name !== undefined ? scope.initial.get(name) : undefined;
    const selected = start === undefined || start === null ? -1 : options.findIndex((o) => o.value === String(start));
    const id = name ?? `choice-${this.choices.size + 1}`;
    if (name !== undefined) this.choices.set(name, options.map((o) => o.value));
    return { type: 'choice', id, options: options.map((o) => ({ label: o.label })), selected };
  }

  /** `{list.length}` where `list` is a `useState` list: how many items are checked. */
  private counter(expr: string, scope: Scope): boolean {
    const m = /^([A-Za-z_$][\w$]*)\.length$/.exec(expr.trim());
    return !!m && scope.state.has(m[1]!) && Array.isArray(scope.initial.get(m[1]!));
  }

  /** A button whose click only sets `useState` values back to where they started. */
  private resets(n: Extract<Node, { t: 'el' }>, scope: Scope): boolean {
    const a = n.attrs['onClick'];
    if (a?.kind !== 'expr') return false;
    const body = /^\(\s*\)\s*=>\s*\{?([\s\S]*?)\}?\s*$/.exec(a.value)?.[1];
    if (body === undefined) return false;
    const calls = body.split(';').map((c) => c.trim()).filter(Boolean);
    return (
      calls.length > 0 &&
      calls.every((call) => {
        const m = /^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/.exec(call);
        const state = m ? scope.setters.get(m[1]!) : undefined;
        if (!m || state === undefined) return false;
        const r = new LiteralReader(m[2]!, 0);
        try {
          const v = r.value();
          r.space();
          return r.i === m[2]!.length && JSON.stringify(v) === JSON.stringify(scope.initial.get(state));
        } catch (e) {
          if (e instanceof Unreadable) return false;
          throw e;
        }
      })
    );
  }
}

function attrValue(n: Extract<Node, { t: 'el' }>, name: string, scope: Scope): string | undefined {
  const a = n.attrs[name];
  if (!a || a.kind === 'flag') return undefined;
  if (a.kind === 'string') return a.value;
  const v = evaluate(a.value, scope);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

function dependsOnState(expr: string, scope: Scope): boolean {
  const seen = { usesState: false };
  evaluate(expr, scope, seen);
  if (seen.usesState) return true;
  // An expression we cannot evaluate that names a state variable (`checked.length + 1`) depends on it too.
  const words = new Set(expr.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []);
  return [...scope.state].some((s) => words.has(s));
}

/**
 * Text inside the markup is indented for layout only; left in, Markdown reads it as code. Remove the indentation
 * each paragraph's lines share, keeping the relative indentation of nested lists. The first line follows a tag and
 * keeps its spacing.
 */
function dedent(text: string): string {
  const indent = (l: string) => /^[ \t]*/.exec(l)![0].length;
  return text
    .split(/(\n[ \t]*\n)/)
    .map((chunk, k) => {
      if (k % 2 === 1) return chunk;
      const lines = chunk.split('\n');
      const from = k === 0 ? 1 : 0;
      const indents = lines.slice(from).filter((l) => l.trim() !== '').map(indent);
      const min = indents.length ? Math.min(...indents) : 0;
      return lines.map((l, i) => (i < from ? l : l.slice(Math.min(min, indent(l))))).join('\n');
    })
    .join('');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeAlt(s: string): string {
  return oneLine(s).replace(/[[\]\\]/g, '\\$&');
}

/** A paragraph break the conversion made: the whitespace around it is layout only. */
const BLOCK = '\u0002';
/** Marks list items the conversion made, so consecutive ones are joined into one list. */
const ITEM = '\u0001';

/** Turn the conversion's markers into Markdown: one blank line per break, list items kept together. */
function tidy(md: string): string {
  return md
    .replace(/\s*\u0002[\s\u0002]*/g, BLOCK)
    .replace(/\u0002(?=\u0001)/g, (_, i: number, all: string) => (all.lastIndexOf(ITEM, i) > all.lastIndexOf(BLOCK, i - 1) ? '\n' : '\n\n'))
    .replaceAll(BLOCK, '\n\n')
    .replaceAll(ITEM, '')
    .replace(/(\S) {2,}(?=\S)/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n');
}
