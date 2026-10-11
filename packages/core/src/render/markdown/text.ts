import MarkdownIt from 'markdown-it';

/**
 * Markdown text conversion for export: LaTeX delimiters and `$` escaping, done with a tokenizer so code is never
 * touched. Pure and deterministic.
 *
 * @packageDocumentation
 */

/**
 * Target Markdown dialect.
 *
 * - `github`: GitHub Flavored Markdown. Inline math as ``$`x`$`` (GitHub's form that survives `_` and `*` inside),
 *   display math as `$$`, collapsible `<details>` for reasoning, YAML front matter.
 * - `obsidian`: Obsidian. Inline math as `$x$`, display as `$$`, callouts (`> [!abstract]-`) for reasoning and notes.
 * - `commonmark`: pure CommonMark. Math as `$x$` / `$$` (the Pandoc convention; CommonMark itself has no math, and
 *   keeping `\(` would render as a bare `(`), plain blockquotes, no front matter by default.
 */
export type MarkdownFlavor = 'github' | 'obsidian' | 'commonmark';

export const MARKDOWN_FLAVORS: readonly MarkdownFlavor[] = ['github', 'obsidian', 'commonmark'];

// Block-level structure only; inline parsing is done below with source positions, which markdown-it does not give.
const blockParser = new MarkdownIt('commonmark', { html: true });

/**
 * Convert one Markdown text from the provider's dialect to `flavor`.
 *
 * - `\( x \)` becomes inline math and `\[ x \]` display math (`$$`), in the flavor's syntax. Delimiters are matched
 *   only outside fenced and indented code blocks, inline code spans, HTML blocks, autolinks and link destinations,
 *   and never across a
 *   blank line; an unmatched delimiter is left exactly as written.
 * - Existing `$$ … $$` display math is kept.
 * - Existing `$x$` inline math is kept when it follows Pandoc's rule (the opening `$` is followed by a non-space,
 *   the closing one follows a non-space and is not followed by a digit), so math a person typed with dollars survives.
 * - Every other `$` in prose is escaped as `\$` (currency, shell variables), so no renderer mistakes it for math.
 * - Link destinations are copied as is, so a URL holding `$` or `\(` is not rewritten.
 * - `\r\n` line endings become `\n`. Nothing else changes: code is byte-for-byte identical.
 *
 * @example
 * ```ts
 * convertMarkdownText('Area \\(\\pi r^2\\) costs $5. `$HOME` stays.', 'obsidian');
 * // 'Area $\\pi r^2$ costs \\$5. `$HOME` stays.'
 * ```
 */
export function convertMarkdownText(text: string, flavor: MarkdownFlavor): string {
  const source = text.replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const isCode = codeLines(source, lines.length);

  const out: string[] = [];
  let free: string[] = [];
  const flush = () => {
    if (free.length) out.push(convertInline(free.join('\n'), flavor));
    free = [];
  };
  lines.forEach((line, i) => {
    if (isCode[i]) {
      flush();
      out.push(line);
    } else {
      free.push(line);
    }
  });
  flush();
  return out.join('\n');
}

/** Per line: true when it belongs to a fenced or indented code block or an HTML block (kept verbatim). */
function codeLines(source: string, count: number): boolean[] {
  const flags = new Array<boolean>(count).fill(false);
  for (const token of blockParser.parse(source, {})) {
    if ((token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') && token.map) {
      for (let i = token.map[0]; i < token.map[1] && i < count; i++) flags[i] = true;
    }
  }
  return flags;
}

const AUTOLINK = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/;

function convertInline(s: string, flavor: MarkdownFlavor): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === '(' || next === '[') {
        const close = next === '(' ? '\\)' : '\\]';
        const end = findMathClose(s, i + 2, close);
        if (end !== -1) {
          const body = s.slice(i + 2, end);
          if (body.trim() !== '') {
            out += next === '(' ? inlineMath(body, flavor) : `$$${body}$$`;
            i = end + 2;
            continue;
          }
        }
      }
      // Any other backslash escape (including `\$` and `\\`) is copied as a pair, so the escaped char is not re-read.
      out += next === undefined ? ch : ch + next;
      i += next === undefined ? 1 : 2;
      continue;
    }
    if (ch === '`') {
      const run = runLength(s, i, '`');
      const end = findBacktickClose(s, i + run, run);
      const stop = end === -1 ? i + run : end + run;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '<') {
      const m = AUTOLINK.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === '$') {
      if (s[i + 1] === '$') {
        const end = findDisplayDollarClose(s, i + 2);
        if (end !== -1) {
          out += s.slice(i, end + 2);
          i = end + 2;
          continue;
        }
      }
      const end = inlineDollarClose(s, i);
      if (end !== -1) {
        out += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      out += '\\$';
      i += 1;
      continue;
    }
    if (ch === ']' && s[i + 1] === '(') {
      // A link destination: copied up to its closing parenthesis, so a URL holding `$` or `\(` stays intact.
      const end = linkDestinationEnd(s, i + 1);
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function inlineMath(body: string, flavor: MarkdownFlavor): string {
  const tex = body.trim();
  // GitHub's $`…`$ form keeps Markdown from eating `_` and `*`; it cannot hold a backtick, so fall back to $…$.
  return flavor === 'github' && !tex.includes('`') ? `$\`${tex}\`$` : `$${tex}$`;
}

/** Index of the closing `\)` / `\]`, skipping `\\` and other escaped pairs; -1 if none before a blank line. */
function findMathClose(s: string, from: number, close: string): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\n' && isBlankLineAt(s, i + 1)) return -1;
    if (s[i] !== '\\') continue;
    if (s.startsWith(close, i)) return i;
    i++; // skip the escaped char, e.g. the second `\` of `\\`
  }
  return -1;
}

/**
 * Index of the `$` closing inline math opened at `start`, or -1 (Pandoc's rule): the opening `$` is followed by a
 * non-space, the closing one follows a non-space and is not followed by a digit, and math does not cross a blank
 * line. So `$x^2$` is kept as math while `$5 to $10` is two prices.
 */
function inlineDollarClose(s: string, start: number): number {
  const first = s[start + 1];
  if (first === undefined || first === '$' || /\s/.test(first)) return -1;
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\n' && isBlankLineAt(s, i + 1)) return -1;
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$') return /\s/.test(s[i - 1]!) || /[0-9]/.test(s[i + 1] ?? '') ? -1 : i;
  }
  return -1;
}

/** Index of the `)` matching the `(` at `open` (nested pairs allowed), or the end of the line when unmatched. */
function linkDestinationEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
    else if (ch === '\n') return i - 1;
  }
  return s.length - 1;
}

function findDisplayDollarClose(s: string, from: number): number {
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === '\n' && isBlankLineAt(s, i + 1)) return -1;
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '$') return i;
  }
  return -1;
}

/** CommonMark code span: the closing run must have exactly `len` backticks. */
function findBacktickClose(s: string, from: number, len: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '\n' && isBlankLineAt(s, i + 1)) return -1;
    if (s[i] === '`') {
      const run = runLength(s, i, '`');
      if (run === len) return i;
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

function runLength(s: string, at: number, ch: string): number {
  let n = 0;
  while (s[at + n] === ch) n++;
  return n;
}

function isBlankLineAt(s: string, at: number): boolean {
  for (let i = at; i < s.length; i++) {
    if (s[i] === '\n') return true;
    if (s[i] !== ' ' && s[i] !== '\t') return false;
  }
  return true;
}

/**
 * Escape plain text (a title, a file name, a label) so Markdown shows it literally on one line.
 *
 * @example
 * ```ts
 * escapeMarkdownInline('a_b *c* [d] $5 & co'); // 'a\\_b \\*c\\* \\[d\\] \\$5 \\& co'
 * ```
 */
export function escapeMarkdownInline(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replace(/[\\`*_[\]<>#|$~!&]/g, '\\$&');
}
