import { describe, expect, it } from 'vitest';
import { convertMarkdownText, escapeMarkdownInline, type MarkdownFlavor } from '@echoes/core';

const ob = (s: string) => convertMarkdownText(s, 'obsidian');
const gh = (s: string) => convertMarkdownText(s, 'github');

describe('convertMarkdownText: math delimiters', () => {
  it('converts inline and display delimiters per flavor', () => {
    expect(ob('Area \\( \\pi r^2 \\) here')).toBe('Area $\\pi r^2$ here');
    expect(gh('Area \\( \\pi r^2 \\) here')).toBe('Area $`\\pi r^2`$ here');
    expect(convertMarkdownText('Area \\(x\\)', 'commonmark')).toBe('Area $x$');
    for (const f of ['github', 'obsidian', 'commonmark'] as MarkdownFlavor[]) {
      expect(convertMarkdownText('Then:\n\n\\[\n\\frac{a}{b}\n\\]\n\nDone.', f)).toBe('Then:\n\n$$\n\\frac{a}{b}\n$$\n\nDone.');
    }
  });

  it('falls back to $…$ on GitHub when the math contains a backtick', () => {
    expect(gh('\\(a`b\\)')).toBe('$a`b$');
  });

  it('keeps LaTeX line breaks and escaped delimiters inside math', () => {
    expect(ob('\\[ a \\\\ b \\]')).toBe('$$ a \\\\ b $$');
    expect(ob('\\( f\\(x\\) \\)')).toBe('$f\\(x$ \\)'); // first unescaped \) closes, as in ChatGPT's own renderer
  });

  it('leaves unmatched, empty, and blank-line-crossing delimiters as written', () => {
    expect(ob('open \\( never closed')).toBe('open \\( never closed');
    expect(ob('empty \\(  \\) math')).toBe('empty \\(  \\) math');
    expect(ob('\\[ a\n\nb \\]')).toBe('\\[ a\n\nb \\]');
  });

  it('does not treat an escaped backslash as an opener', () => {
    expect(ob('path C:\\\\(x\\) here')).toBe('path C:\\\\(x\\) here');
  });

  it('works inside table cells, lists and blockquotes', () => {
    expect(ob('| a | \\(x_1/x_2\\) |\n|---|---|')).toBe('| a | $x_1/x_2$ |\n|---|---|');
    expect(ob('- item \\(x\\)\n> quote \\(y\\)')).toBe('- item $x$\n> quote $y$');
  });
});

describe('convertMarkdownText: code is never touched', () => {
  it('skips fenced code, including tilde fences and fences in blockquotes', () => {
    const src = 'Cost $5\n\n```bash\necho $HOME \\(x\\)\n```\n\n~~~\n$a \\[b\\]\n~~~\n\n> ```\n> $c\n> ```\n';
    expect(ob(src)).toBe('Cost \\$5\n\n```bash\necho $HOME \\(x\\)\n```\n\n~~~\n$a \\[b\\]\n~~~\n\n> ```\n> $c\n> ```\n');
  });

  it('skips indented code blocks', () => {
    expect(ob('Text $1\n\n    let x = $y \\(z\\)\n\nMore')).toBe('Text \\$1\n\n    let x = $y \\(z\\)\n\nMore');
  });

  it('skips an unterminated fence to the end of the text', () => {
    expect(ob('a $1\n```\n$x')).toBe('a \\$1\n```\n$x');
  });

  it('skips inline code spans of any length, including multi-line ones', () => {
    expect(ob('Use `$PATH` and ``a ` $b`` and `\\(x\\)` but \\(y\\)')).toBe('Use `$PATH` and ``a ` $b`` and `\\(x\\)` but $y$');
    expect(ob('`a\n$b` $c')).toBe('`a\n$b` \\$c');
  });

  it('treats an unmatched backtick run as text', () => {
    expect(ob('a ` b $1')).toBe('a ` b \\$1');
    expect(ob('a `` b ` $1')).toBe('a `` b ` \\$1');
  });

  it('skips HTML blocks and autolinks', () => {
    expect(ob('<div>\n$5\n</div>\n\nok $5')).toBe('<div>\n$5\n</div>\n\nok \\$5');
    expect(ob('<https://x.test/$id> $5')).toBe('<https://x.test/$id> \\$5');
  });
});

describe('convertMarkdownText: dollar signs', () => {
  it('escapes currency and stray dollars in prose', () => {
    expect(ob('It costs $5 to $10, or US$3.')).toBe('It costs \\$5 to \\$10, or US\\$3.');
    expect(ob('Set $HOME first')).toBe('Set \\$HOME first');
  });

  it('keeps already escaped dollars and existing $$ display math', () => {
    expect(ob('Price \\$5')).toBe('Price \\$5');
    expect(ob('$$\nx^2\n$$')).toBe('$$\nx^2\n$$');
    expect(ob('lone $$ sign')).toBe('lone \\$\\$ sign');
  });

  it('keeps existing $…$ inline math by Pandoc\'s rule, and escapes prices', () => {
    expect(ob('we have $x^2$ and $$y$$')).toBe('we have $x^2$ and $$y$$');
    expect(gh('What is $2+2$?')).toBe('What is $2+2$?');
    expect(ob('$20,000 and $30,000')).toBe('\\$20,000 and \\$30,000'); // closing $ followed by a digit
    expect(ob('pay $ 5 or $ 6')).toBe('pay \\$ 5 or \\$ 6'); // opening $ followed by a space
    expect(ob('$a\n\nb$')).toBe('\\$a\n\nb\\$'); // never across a blank line
  });

  it('leaves link destinations alone', () => {
    expect(ob('[price](https://x.example/$5?q=\\(1\\)) $5')).toBe('[price](https://x.example/$5?q=\\(1\\)) \\$5');
  });

  it('converts math in Greek prose', () => {
    expect(ob('Η μάζα \\(m\\) κοστίζει $3')).toBe('Η μάζα $m$ κοστίζει \\$3');
  });

  it('is idempotent on its own output', () => {
    const once = ob('Area \\(\\pi r^2\\) costs $5, `$x`, $$y$$');
    expect(ob(once)).toBe(once);
  });
});

describe('convertMarkdownText: text handling', () => {
  it('normalizes line endings and keeps everything else byte-identical', () => {
    expect(ob('a\r\nb\rc')).toBe('a\nb\nc');
    const plain = '# Γειά σου κόσμε\n\n**bold** _it_ [l](u) שָׁלוֹם مَرْحَبًا 你好 İstanbul';
    expect(ob(plain)).toBe(plain);
  });

  it('is deterministic', () => {
    const s = 'a \\(x\\) $1 `c`';
    expect(gh(s)).toBe(gh(s));
  });
});

describe('escapeMarkdownInline', () => {
  it('escapes Markdown syntax and folds newlines', () => {
    expect(escapeMarkdownInline('a_b *c* [d] $5 # x | y\n z')).toBe('a\\_b \\*c\\* \\[d\\] \\$5 \\# x \\| y z');
  });
});
