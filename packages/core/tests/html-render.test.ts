import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HTML_THEMES,
  markdownToHtml,
  parseConversation,
  pathThrough,
  renderHtml,
  renderHtmlBranches,
  selectTraversals,
  type Block,
  type Conversation,
  type Resource,
} from '@echoes/core';
import { codeLanguages, createShikiHighlighter } from '@echoes/core/highlight';
import { sampleJson } from './helpers.ts';

const showcase = (): Conversation =>
  parseConversation(JSON.parse(readFileSync(new URL('./fixtures/render-showcase.json', import.meta.url), 'utf8')));
const files = (r: Resource) => `files/${r.name ?? r.fileId}`;

/** The sample chat with the active answer's blocks replaced. */
function withAnswer(...blocks: Block[]): Conversation {
  const json = sampleJson();
  json.nodes['a2b2']!.blocks = blocks;
  return parseConversation(json);
}
const md = (text: string): Block => ({ kind: 'markdown', text });

describe('renderHtml golden output', () => {
  it('showcase, article theme, no highlighting', async () => {
    await expect(renderHtml(showcase(), { resolveResource: files })).toMatchFileSnapshot('golden/showcase.article.html');
  });
});

describe('renderHtml', () => {
  it('is a self-contained page: inline CSS, no scripts, a CSP that blocks them', () => {
    const html = renderHtml(showcase());
    expect(html.startsWith('<!doctype html>\n<html>\n')).toBe(true);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'`);
    expect(html).not.toMatch(/<script|<link /);
    expect(renderHtml(showcase())).toBe(html);
  });

  it('every theme renders, and a forced color scheme sets the class', () => {
    for (const theme of HTML_THEMES) expect(renderHtml(showcase(), { theme })).toContain(`<body class="theme-${theme}">`);
    expect(renderHtml(showcase(), { colorScheme: 'dark' })).toContain('<html class="dark">');
  });

  it('shows raw HTML in chat text as text, never as markup', () => {
    const html = renderHtml(withAnswer(md('<script>alert(1)</script> and <img src=x onerror=alert(1)>')));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src="x"');
  });

  it('does not link javascript: URLs, in text or in citations', () => {
    const html = renderHtml(withAnswer(md('[x](javascript:alert(1))'), { kind: 'citation', url: 'javascript:alert(1)', title: 'bad' }));
    expect(html).not.toMatch(/href="javascript/i);
  });

  it('math becomes MathML; currency and code keep their dollars', () => {
    const html = renderHtml(withAnswer(md('Area \\(\\pi r^2\\) costs $5. `$HOME` stays.\n\n\\[ x^2 \\]')));
    expect(html).toMatch(/<math[^>]*><semantics><mrow><mi>π<\/mi>/);
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">');
    expect(html).toContain('costs $5.');
    expect(html).toContain('<code>$HOME</code>');
  });

  it('a bad formula shows its source instead of failing the export', () => {
    expect(renderHtml(withAnswer(md('\\( \\frac{ \\)')))).toContain('\\frac{');
  });

  it('headings inside a message sit below the message heading', () => {
    const html = renderHtml(withAnswer(md('# Big\n\n### Small')));
    expect(html).toContain('<h4>Big</h4>');
    expect(html).toContain('<h6>Small</h6>');
  });

  it('marks short code blocks so print keeps them on one page, and wraps tables', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const html = renderHtml(withAnswer({ kind: 'code', text: 'print(1)', lang: 'python', origin: 'fence' }, { kind: 'code', text: long, origin: 'fence' }, md('| a |\n| - |\n| 1 |')));
    expect(html).toContain('<div class="code short"><div class="code-lang">python</div><pre><code>print(1)</code></pre></div>');
    expect(html).toContain('<div class="code"><pre><code>line 0');
    expect(html).toContain('<div class="table-wrap"><table>');
  });

  it('lets each message choose its direction, for Hebrew and Arabic', () => {
    expect(renderHtml(withAnswer(md('שלום')))).toMatch(/<div class="body" dir="auto">\n(<p class="version">[^<]*<\/p>\n)?<p>שלום<\/p>/);
  });

  it('files: images inline when exported, placeholders otherwise', () => {
    const r = (status: Resource['status']): Resource => ({ fileId: 'file-1', name: 'cat.jpg', status });
    const html = renderHtml(withAnswer({ kind: 'image', resource: r('ok'), generated: true }, { kind: 'attachment', resource: r('expired') }), { resolveResource: files });
    expect(html).toContain('<img src="files/cat.jpg" alt="cat.jpg" loading="lazy">');
    expect(html).toContain('<p class="missing">[Attachment expired: cat.jpg]</p>');
  });

  it('web images: the source page under the image, and a link to it when the image was not saved', () => {
    const web = (status: Resource['status']): Block => ({
      kind: 'image',
      resource: { fileId: 'web:img-1', name: 'Kalbsragout', url: 'https://images.openai.com/static-rsc-4/abc', status },
      generated: false,
      source: { title: 'Kalbsragout <mit> Steinpilzen', url: 'https://www.chefkoch.de/rezepte/1' },
    });
    expect(renderHtml(withAnswer(web('ok')), { resolveResource: files })).toContain(
      '<figure><img src="files/Kalbsragout" alt="Kalbsragout" loading="lazy"><figcaption>Source: <a href="https://www.chefkoch.de/rezepte/1">Kalbsragout &lt;mit&gt; Steinpilzen</a></figcaption></figure>',
    );
    expect(renderHtml(withAnswer(web('pending')))).toContain(
      '<p class="missing">[Image not included: Kalbsragout] Source: <a href="https://www.chefkoch.de/rezepte/1">Kalbsragout &lt;mit&gt; Steinpilzen</a></p>',
    );
  });

  it('version notes, reasoning in a details box, sources listed once', () => {
    const c = parseConversation(sampleJson());
    const html = renderHtml(c, { path: pathThrough(c, 'u2a') });
    expect(html).toContain('<p class="version">Version 1 of 2 (edited question)</p>');
    expect(html).toContain('<details class="reasoning">\n<summary>Reasoning summary</summary>');
  });

  it('branches: shared turns once, then a section per branch', () => {
    const c = parseConversation(sampleJson());
    const picked = selectTraversals(c, { mode: 'all' });
    const html = renderHtmlBranches(c, picked.map((t) => ({ name: t.name, nodeIds: t.nodeIds })));
    expect(html.match(/<section class="branch" id="branch-\d">/g)).toHaveLength(3);
    expect(html).toContain('<h2>Branch 1 of 3 (the one shown in the chat)</h2>\n<p class="branch-name">Turn 2: question version 2 of 2 · Turn 2: answer version 2 of 2</p>');
    expect(html.match(/id="turn-1"/g)).toHaveLength(1);
  });
});

describe('markdownToHtml', () => {
  it('converts provider Markdown on its own', () => {
    expect(markdownToHtml('Visit https://example.com, **now**')).toBe(
      '<p>Visit <a href="https://example.com" rel="noopener noreferrer">https://example.com</a>, <strong>now</strong></p>\n',
    );
  });
});

describe('highlighting', () => {
  it('collects the languages a chat uses', () => {
    const c = withAnswer({ kind: 'code', text: 'x', lang: 'Python', origin: 'fence' }, md('```ts\nlet a\n```\n\n~~~ rust\nfn x\n~~~'));
    expect(codeLanguages([c])).toEqual(['python', 'rust', 'ts']);
  });

  it('colors known languages for light and dark, leaves others plain', async () => {
    const highlight = await createShikiHighlighter({ langs: ['py'] });
    const html = renderHtml(withAnswer(md('```py\nx = 1\n```\n\n```cobol\nX\n```')), { highlight });
    expect(html).toContain('<pre class="shiki shiki-themes github-light github-dark"');
    expect(html).toContain('<div class="code short"><div class="code-lang">cobol</div><pre><code>X</code></pre></div>');
  });
});
