/**
 * ChatGPT's layout markup. Some answers are not plain Markdown: the web app renders tags such as `<box>`, `<row>`,
 * `<text>`, `<badge>`, `<AsyncImage>`, `<Cite>` and `<Link>` as cards, and small widgets written with a template
 * syntax (`{@body const items = [...]}`, `{#each items as item}`, `<checkbox>`) as interactive lists. Left as is, the
 * tags break Markdown (an HTML block swallows the section) and show as text in HTML.
 *
 * {@link convertLayoutMarkup} turns that markup into plain Markdown. The tags come from real chats (2026-10-11). What
 * the web app found live for an `AsyncImage`, `Cite` or `Link` is not in the text: the caller passes a
 * {@link LayoutResolver} that looks it up by the tag's position (the ChatGPT adapter reads it from the message's
 * `genui_components`).
 *
 * Rules, by tag:
 *
 * - containers (`box`, `row`, `grid`, `grid-item`, `radio-group`, …) become paragraph breaks;
 * - `divider` becomes a thematic break;
 * - `title` becomes a bold line, `caption` an italic line, `badge` bold text, `text` and `Entity` their content;
 * - `AsyncImage` becomes an image when the resolver knows it, else an "Image: …" note with its search query;
 * - `Link` becomes a link when its URL is known, else its text; `Cite` becomes links to the cited pages when the
 *   resolver knows them, else nothing (the cited URLs are also listed after the answer);
 * - `checkbox` becomes a task list item, `radio` a list item; `icon` and `button` are dropped.
 *
 * Widget templates are expanded without running any code: `{@body const x = <literal>}` declarations are read with a
 * literal parser (arrays, objects, strings, numbers), `useState(<literal>)` binds its initial value, `{#each}` repeats
 * over lists, `{#if}` picks a branch, and `{name.path}` is substituted. The expressions understood are paths
 * (`a.b[0]`, `a[b]`), `.length`, `Number(…)` and `String(…)`; anything else (function calls, arithmetic) is dropped.
 * Text showing live widget state (a "0/12" counter) is dropped too. A list that cannot be read becomes one note.
 *
 * Fenced code blocks, inline code, math and ChatGPT's citation markers are never touched.
 *
 * @packageDocumentation
 */

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

/** Where a tag is: its offset in the text given to {@link convertLayoutMarkup} (UTF-16 units), and its ordinal among tags of the same name (0-based). */
export interface TagPosition {
  offset: number;
  ordinal: number;
}

export interface WebLink {
  url: string;
  title?: string;
}

/** An image the web app found for an `AsyncImage`. */
export interface LayoutImage {
  /** The image itself. */
  url: string;
  /** The resolver's own id for it, kept as is. */
  id?: string;
  /** The tag's search query, a description of what the image shows. */
  alt?: string;
  /** The page the image was found on. */
  source?: WebLink;
}

/** Looks up what the web app found live for a tag. Each method may return undefined when it does not know. */
export interface LayoutResolver {
  image?(at: TagPosition): LayoutImage | undefined;
  cite?(at: TagPosition): WebLink[] | undefined;
  link?(at: TagPosition): WebLink | undefined;
}

/** A piece of converted output: Markdown text, or an image the resolver found, to show between the texts. */
export type LayoutPiece = { markdown: string } | { image: LayoutImage };

export interface LayoutResult {
  /** The whole answer as Markdown; resolved images are Markdown images pointing at their URL. */
  markdown: string;
  /** The same content split at resolved images, for hosts that save images as files. */
  pieces: LayoutPiece[];
  /** Images shown only as a note with their search query: the web app found them live and the resolver did not know them. */
  unresolvedImages: number;
  /** Widget lists whose data could not be read. */
  unreadableWidgets: number;
}

/** Convert ChatGPT's layout markup in `text` to Markdown. Text without it comes back unchanged. */
export function convertLayoutMarkup(text: string, resolver: LayoutResolver = {}): LayoutResult {
  const result: LayoutResult = { markdown: text, pieces: text ? [{ markdown: text }] : [], unresolvedImages: 0, unreadableWidgets: 0 };
  if (!LAYOUT_HINT.test(text)) return result;
  const images: LayoutImage[] = [];
  const converter = new Converter(resolver, result, images);
  const ordinals = new Map<string, number>();
  const out = splitProtected(text).map((seg) => (seg.keep ? seg.text : tidy(converter.run(new Parser(seg.text, seg.offset, ordinals).parse()))));
  const joined = out.join('').trim();
  result.markdown = joined.replace(SLOT, (_, n: string) => {
    const img = images[Number(n)]!;
    return `![${escapeAlt(img.alt ?? img.source?.title ?? '')}](${img.url})`;
  });
  result.pieces = [];
  joined.split(SLOT_SPLIT).forEach((piece, i) => {
    if (i % 2 === 1) result.pieces.push({ image: images[Number(piece)]! });
    else if (piece.trim()) result.pieces.push({ markdown: piece.trim() });
  });
  return result;
}

/** Stands for a resolved image in the converted text until the end: `\u0003<index>\u0003`. */
const SLOT = /\u0003(\d+)\u0003/g;
const SLOT_SPLIT = /\u0003(\d+)\u0003/;

// ---------------------------------------------------------------------------------------------------------------
// Protected regions

interface Segment {
  keep: boolean;
  text: string;
  offset: number;
}

/** Split off fenced code blocks and display math so they pass through untouched. */
function splitProtected(text: string): Segment[] {
  const out: Segment[] = [];
  const region = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[`~]*[ \t]*$|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/gm;
  let last = 0;
  for (const m of text.matchAll(region)) {
    if (m.index > last) out.push({ keep: false, text: text.slice(last, m.index), offset: last });
    out.push({ keep: true, text: m[0], offset: m.index });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ keep: false, text: text.slice(last), offset: last });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing: a forgiving reader for tags and template blocks. Anything it does not recognize stays text.

type Node =
  | { t: 'text'; text: string }
  | { t: 'el'; name: string; attrs: Record<string, Attr>; children: Node[]; at: TagPosition }
  | { t: 'body'; source: string }
  | { t: 'each'; expr: string; item: string; index?: string; children: Node[] }
  | { t: 'if'; expr: string; then: Node[]; else: Node[] }
  | { t: 'expr'; expr: string };

type Attr = { kind: 'string'; value: string } | { kind: 'expr'; value: string } | { kind: 'flag' };

class Parser {
  i = 0;
  readonly s: string;
  /** Offset of `s` in the whole text, and the tag counts so far, for {@link TagPosition}. */
  readonly base: number;
  readonly ordinals: Map<string, number>;
  constructor(s: string, base = 0, ordinals = new Map<string, number>()) {
    this.s = s;
    this.base = base;
    this.ordinals = ordinals;
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
    while (this.i < this.s.length) {
      const c = this.s[this.i]!;
      if (c === '`' || c === '\ue200' || (c === '\\' && this.s[this.i + 1] === '(')) {
        // Inline code, a citation marker or inline math: copied through untouched.
        const end = c === '`' ? this.codeSpanEnd() : c === '\ue200' ? this.s.indexOf('\ue201', this.i) + 1 : this.s.indexOf('\\)', this.i + 2) + 2;
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
          nodes.push(el);
          continue;
        }
      }
      if (c === '{' && (/^\{[@#:/][a-z]/.test(this.s.slice(this.i, this.i + 3)) || this.exprAllowedHere())) {
        const end = matchBrace(this.s, this.i);
        const inner = end > 0 ? this.s.slice(this.i + 1, end) : '';
        if (inner.startsWith('@body')) {
          flush();
          nodes.push({ t: 'body', source: inner.slice(5).trim() });
          this.i = end + 1;
          continue;
        }
        const each = /^#each\s+([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*(?:\([^)]*\))?\s*$/.exec(inner);
        if (each) {
          flush();
          this.i = end + 1;
          const body = this.nodes('/each');
          const node: Node = { t: 'each', expr: each[1]!.trim(), item: each[2]!, children: body.nodes };
          if (each[3]) node.index = each[3];
          nodes.push(node);
          continue;
        }
        const iff = /^#if\s+([\s\S]+)$/.exec(inner);
        if (iff) {
          flush();
          this.i = end + 1;
          const then = this.nodes('/if');
          const other = then.ended === ':else' ? this.nodes('/if').nodes : [];
          nodes.push({ t: 'if', expr: iff[1]!.trim(), then: then.nodes, else: other });
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
          nodes.push({ t: 'expr', expr: inner.trim() });
          this.i = end + 1;
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
    const at = (): TagPosition => {
      const ordinal = this.ordinals.get(name) ?? 0;
      this.ordinals.set(name, ordinal + 1);
      return { offset: this.base + start, ordinal };
    };
    for (;;) {
      this.skipSpace();
      if (this.s.startsWith('/>', this.i)) {
        this.i += 2;
        return { t: 'el', name, attrs, children: [], at: at() };
      }
      if (this.s[this.i] === '>') {
        this.i++;
        const pos = at();
        return { t: 'el', name, attrs, children: this.nodes(name).nodes, at: pos };
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
      const pair = /^\[\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\]\s*=\s*[\w$.]*useState\(/.exec(s.slice(i));
      if (pair) {
        i += pair[0].length;
        const r = new LiteralReader(s, i);
        const v = r.value();
        r.space();
        if (s[r.i] !== ')') return;
        i = r.i + 1;
        scope.values.set(pair[1]!, v);
        scope.state.add(pair[1]!);
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
  readonly images: LayoutImage[];
  constructor(resolver: LayoutResolver, result: LayoutResult, images: LayoutImage[]) {
    this.resolver = resolver;
    this.result = result;
    this.images = images;
  }

  run(nodes: Node[]): string {
    const scope: Scope = { values: new Map(), state: new Set() };
    // Text outside any tag is ordinary Markdown and is kept exactly; only text inside the markup is re-indented.
    return nodes.map((n) => (n.t === 'text' ? n.text : this.node(n, scope))).join('');
  }

  private nodes(nodes: Node[], scope: Scope): string {
    let out = '';
    for (const n of nodes) out += this.node(n, scope);
    return out;
  }

  private node(n: Node, scope: Scope): string {
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
            const inner: Scope = { values: new Map(scope.values), state: scope.state };
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
        return t.includes('\n') ? `${BLOCK}${t}${BLOCK}` : ` ${t} `;
      }
      case 'Entity':
        return n.children.length ? inner() : (attr('value') ?? attr('name') ?? '');
      case 'AsyncImage': {
        const query = attr('query') ?? attr('alt');
        const found = this.resolver.image?.(n.at);
        if (found && isWebUrl(found.url)) {
          const image: LayoutImage = { ...found };
          if (query && !image.alt) image.alt = oneLine(query);
          this.images.push(image);
          return `${BLOCK}\u0003${this.images.length - 1}\u0003${BLOCK}`;
        }
        this.result.unresolvedImages++;
        return `${BLOCK}${query ? `*[Image: ${oneLine(query)}]*` : '*[Image]*'}${BLOCK}`;
      }
      case 'Link': {
        const a = n.attrs['url'] ?? n.attrs['href'];
        let url: string | undefined;
        if (a?.kind === 'string') url = a.value;
        else if (a?.kind === 'expr') {
          const v = evaluate(a.value, scope);
          if (typeof v === 'string') url = v;
        }
        const found = this.resolver.link?.(n.at);
        if (!url || !isWebUrl(url)) url = found?.url;
        const label = inner() || attr('title') || found?.title || '';
        if (url && isWebUrl(url)) return `[${escapeLabel(label || url)}](${url})`;
        return label;
      }
      case 'Cite': {
        const links = (this.resolver.cite?.(n.at) ?? []).filter((l) => isWebUrl(l.url));
        if (!links.length) return '';
        return ` (${links.map((l) => `[${escapeLabel(l.title ?? l.url)}](${l.url})`).join(', ')})`;
      }
      case 'checkbox':
        return `${BLOCK}${ITEM}- [ ] ${inner()}${BLOCK}`;
      case 'radio':
        return `${BLOCK}${ITEM}- ${inner()}${BLOCK}`;
      default: // icon, button
        return '';
    }
  }
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
      return lines.map((l, i) => (i < from ? l : l.trim() === '' ? '' : l.slice(Math.min(min, indent(l))))).join('\n');
    })
    .join('');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\/[^\s()<>]+$/.test(url);
}

function escapeLabel(s: string): string {
  return oneLine(s).replace(/[[\]\\]/g, '\\$&');
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
