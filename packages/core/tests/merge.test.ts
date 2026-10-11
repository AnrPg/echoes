import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  emptyManifest,
  mergeHtml,
  mergeJson,
  mergeMarkdown,
  mergedNeedsRebuild,
  parseConversation,
  parseManifest,
  renderHtml,
  renderJson,
  renderMarkdown,
  serializeManifest,
  shiftMarkdownHeadings,
  type Conversation,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

const widgets = (): Conversation => parseConversation(JSON.parse(readFileSync(new URL('./fixtures/widgets.json', import.meta.url), 'utf8')));
const titled = (c: Conversation, id: string, title: string): Conversation => ({ ...c, id, title });

describe('shiftMarkdownHeadings', () => {
  it('moves headings one level down, but not inside code fences, and stops at six', () => {
    const md = '# A\n\n## B\n\n```md\n# not a heading\n```\n\n~~~\n## nor this\n~~~\n\n###### deepest\n#hashtag';
    expect(shiftMarkdownHeadings(md)).toBe('## A\n\n### B\n\n```md\n# not a heading\n```\n\n~~~\n## nor this\n~~~\n\n###### deepest\n#hashtag');
  });

  it('keeps a longer fence open past a shorter one', () => {
    expect(shiftMarkdownHeadings('````\n```\n# x\n```\n````\n# y')).toBe('````\n```\n# x\n```\n````\n## y');
  });
});

describe('mergeMarkdown', () => {
  const a = titled(sampleJson(), 'a', 'First chat');
  const b = titled(sampleJson(), 'b', 'Second chat');
  const part = (c: Conversation, flavor: 'github' | 'obsidian' | 'commonmark' = 'github') => ({ id: c.id, title: c.title, document: renderMarkdown(c, { flavor, frontMatter: false }) });

  it('writes a title, contents in the given order, and each chat a level deeper', () => {
    const md = mergeMarkdown([part(b), part(a)], { title: 'My Project' });
    expect(md.startsWith('---\ntitle: "My Project"\nchats: 2\nconversation_ids:\n  - "b"\n  - "a"\necho')).toBe(true);
    expect(md).toContain('# My Project\n\n2 chats, in this order:\n\n1. [Second chat](#chat-1)\n2. [First chat](#chat-2)');
    expect(md.indexOf('<a id="chat-1"></a>\n\n## Second chat')).toBeGreaterThan(0);
    expect(md.indexOf('## Second chat')).toBeLessThan(md.indexOf('## First chat'));
    expect(md).toContain('### Turn 1');
    expect(md).not.toMatch(/^## Turn 1$/m);
    expect(md.match(/^# /gm)).toHaveLength(1);
  });

  it('drops each chat\'s own front matter', () => {
    const md = mergeMarkdown([{ id: 'a', title: 'First chat', document: renderMarkdown(a) }], { title: 'T' });
    expect(md.match(/^---$/gm)).toHaveLength(2);
    expect(md).not.toContain('conversation_id:');
  });

  it('links headings the Obsidian way, and has no front matter for CommonMark', () => {
    expect(mergeMarkdown([part(a, 'obsidian')], { title: 'T', flavor: 'obsidian' })).toContain('1. [[#First chat|First chat]]');
    const cm = mergeMarkdown([part(a, 'commonmark')], { title: 'T', flavor: 'commonmark' });
    expect(cm.startsWith('# T\n\n1 chat, in this order:')).toBe(true);
  });
});

describe('mergeHtml', () => {
  const html = (c: Conversation) => ({ id: c.id, title: c.title, document: renderHtml(c, { theme: 'chatgpt' }) });

  it('makes one page with contents, a section per chat and deeper headings', () => {
    const page = mergeHtml([html(titled(sampleJson(), 'a', 'One')), html(titled(sampleJson(), 'b', 'Two'))], { title: 'Both' });
    expect(page.match(/<html/g)).toHaveLength(1);
    expect(page.match(/<main>/g)).toHaveLength(1);
    expect(page).toContain('<title>Both</title>');
    expect(page).toContain('<li><a href="#chat-1">One</a></li>\n<li><a href="#chat-2">Two</a></li>');
    expect(page).toContain('<section class="chat" id="chat-1">\n<header>\n<h2>One</h2>');
    expect(page).toContain('id="c1-turn-1"');
    expect(page).toContain('id="c2-turn-1"');
    expect(page).not.toContain('id="turn-1"');
    expect(page.match(/<h1>/g)).toHaveLength(1);
    expect(page).toContain('<body class="theme-chatgpt">');
    // The reader script runs once, and the merged page lets it fold whole chats.
    expect(page.match(/<script>/g)).toHaveLength(1);
    expect(page).toContain("section.chat')");
  });

  it('allows every part\'s scripts and keeps widget rules pointing at their own widget', () => {
    const w = widgets();
    const alone = renderHtml(w);
    const page = mergeHtml([html(titled(sampleJson(), 'a', 'Plain')), { id: w.id, title: w.title, document: alone }], { title: 'Mixed' });
    const policy = /script-src ([^;"]*)/.exec(page)![1]!.split(' ');
    for (const hash of /script-src ([^;"]*)/.exec(alone)![1]!.split(' ')) expect(policy).toContain(hash);
    expect(page).toContain('<form class="widget" id="c2-widget-1"');
    expect(page).toMatch(/#c2-widget-\d+:has\(/);
    expect(page).not.toMatch(/[^-]#widget-\d+:has\(/);
    // Every script in the page is allowed by the policy.
    for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(policy).toContain(`'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`);
  });

  it('keeps the colour scheme of the parts', () => {
    const page = mergeHtml([{ id: 'a', title: 'A', document: renderHtml(sampleJson(), { colorScheme: 'dark' }) }], { title: 'Dark' });
    expect(page).toContain('<html class="dark">');
  });
});

describe('mergeJson', () => {
  it('bundles each chat\'s JSON unchanged, in order', () => {
    const a = titled(sampleJson(), 'a', 'A');
    const b = titled(sampleJson(), 'b', 'B');
    const bundle = JSON.parse(mergeJson([{ id: 'b', title: 'B', document: renderJson(b) }, { id: 'a', title: 'A', document: renderJson(a) }], { title: 'T' }));
    expect(bundle.echoes_bundle).toBe(1);
    expect(bundle.chats.map((c: Conversation) => c.id)).toEqual(['b', 'a']);
    expect(bundle.chats[1]).toEqual(JSON.parse(renderJson(a)));
  });
});

describe('merged entry in the manifest', () => {
  const key = 'k';
  const withMerged = { ...emptyManifest(), merged: { file: 'P.md', title: 'P', order: ['a', 'b'], settingsKey: key } };

  it('round-trips through manifest.json', () => {
    expect(parseManifest(serializeManifest(withMerged)).merged).toEqual(withMerged.merged);
  });

  it('rebuilds only when a member, the order, the file or the settings changed', () => {
    const same = { file: 'P.md', order: ['a', 'b'], settingsKey: key };
    expect(mergedNeedsRebuild(withMerged, same, [])).toBe(false);
    expect(mergedNeedsRebuild(withMerged, same, ['b'])).toBe(true);
    expect(mergedNeedsRebuild(withMerged, { ...same, order: ['b', 'a'] }, [])).toBe(true);
    expect(mergedNeedsRebuild(withMerged, { ...same, order: ['a'] }, [])).toBe(true);
    expect(mergedNeedsRebuild(withMerged, { ...same, file: 'Q.md' }, [])).toBe(true);
    expect(mergedNeedsRebuild(withMerged, { ...same, settingsKey: 'other' }, [])).toBe(true);
    expect(mergedNeedsRebuild(emptyManifest(), same, [])).toBe(true);
  });
});
