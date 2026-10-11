/**
 * Rewrite LaTeX delimiters in Markdown so math renders in Markdown apps, without touching code.
 *
 * ChatGPT writes math as `\(…\)` and `\[…\]`. Most Markdown apps (Obsidian, GitHub, Pandoc, Typora) only read
 * `$…$` and `$$…$$`, and in plain CommonMark `\(` is just an escaped parenthesis. So:
 *
 * - `\(x\)` becomes `$x$` and `\[x\]` becomes `$$x$$`. The math itself is copied unchanged.
 * - Existing `$…$` and `$$…$$` math is kept as is.
 * - A `$` that does not open valid inline math (for example a price, `$5`) is escaped as `\$`, so a Markdown app
 *   does not pair two prices into one formula.
 * - Nothing changes inside fenced code blocks, inline code spans or link destinations.
 *
 * It is a small tokenizer, not a regex replace: it walks the text once, recognizing fences, code spans, escapes,
 * math and link destinations in the order CommonMark gives them priority.
 *
 * Inline `$…$` uses Pandoc's rule: the opening `$` is followed by a non-space, the closing `$` follows a non-space
 * and is not followed by a digit. So `$x$` is math, while `costs $5 and $10` is two prices.
 *
 * Limits, kept on purpose: 4-space indented code blocks are not recognized (ChatGPT always fences code, and indented
 * text is usually list content, where math should convert), and fences may be indented any amount (fences inside
 * list items).
 *
 * @example
 * ```ts
 * convertMath('Area \\(\\pi r^2\\) costs $5. `\\(not math\\)`');
 * // 'Area $\\pi r^2$ costs \\$5. `\\(not math\\)`'
 * ```
 */
export function convertMath(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; len: number } | undefined;
  const flush = () => {
    if (prose.length) out.push(convertProse(prose.join('\n')));
    prose = [];
  };
  for (const line of lines) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len && m[2]!.trim() === '') fence = undefined;
    } else if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      flush();
      out.push(line);
      fence = { char: m[1]![0]!, len: m[1]!.length };
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/** Convert one stretch of text that holds no fenced code. */
function convertProse(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '`') {
      const run = runLength(s, i, '`');
      const close = findRun(s, i + run, '`', run);
      if (close < 0) {
        out += s.slice(i, i + run); // unmatched backticks are literal
        i += run;
      } else {
        out += s.slice(i, close + run);
        i = close + run;
      }
    } else if (c === '\\') {
      const next = s[i + 1];
      const closer = next === '(' ? '\\)' : next === '[' ? '\\]' : undefined;
      const end = closer ? s.indexOf(closer, i + 2) : -1;
      if (closer && end >= 0) {
        const body = s.slice(i + 2, end);
        out += next === '(' ? `$${body.trim()}$` : `$$${body}$$`;
        i = end + 2;
      } else {
        out += s.slice(i, i + 2); // any other escape, including \$, is copied as is
        i += 2;
      }
    } else if (c === '$') {
      if (s[i + 1] === '$') {
        const end = s.indexOf('$$', i + 2);
        if (end >= 0) {
          out += s.slice(i, end + 2);
          i = end + 2;
        } else {
          out += '\\$\\$';
          i += 2;
        }
      } else {
        const end = inlineMathEnd(s, i);
        if (end >= 0) {
          out += s.slice(i, end + 1);
          i = end + 1;
        } else {
          out += '\\$';
          i += 1;
        }
      }
    } else if (c === ']' && s[i + 1] === '(') {
      // A link destination: copy up to the matching parenthesis so URLs with $ or \( stay intact.
      const end = matchParen(s, i + 1);
      out += s.slice(i, end + 1);
      i = end + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Index of the `$` closing inline math opened at `start`, or -1 (Pandoc's rule, within one paragraph). */
function inlineMathEnd(s: string, start: number): number {
  const first = s[start + 1];
  if (first === undefined || /\s/.test(first)) return -1;
  for (let j = start + 1; j < s.length; j++) {
    const ch = s[j]!;
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '\n' && s[j + 1] === '\n') return -1; // math does not cross a blank line
    if (ch === '$') {
      if (/\s/.test(s[j - 1]!) || /[0-9]/.test(s[j + 1] ?? '')) return -1;
      return j;
    }
  }
  return -1;
}

function runLength(s: string, i: number, ch: string): number {
  let n = 0;
  while (s[i + n] === ch) n++;
  return n;
}

/** Start of the next run of exactly `len` `ch` characters at or after `from`, or -1. */
function findRun(s: string, from: number, ch: string, len: number): number {
  for (let j = from; j < s.length; ) {
    if (s[j] === ch) {
      const n = runLength(s, j, ch);
      if (n === len) return j;
      j += n;
    } else j++;
  }
  return -1;
}

/** Index of the `)` matching the `(` at `open`, allowing nested pairs; the end of the line when unmatched. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') j++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return j;
    else if (ch === '\n') return j - 1;
  }
  return s.length - 1;
}
