import { describe, expect, it } from 'vitest';
import { TURN_PRESETS, pathThrough, renderMarkdown, type Conversation } from '@echoes/core';
import { sampleJson } from './helpers.ts';

// Golden files: any change in output fails until reviewed and updated with `pnpm test -u`.
describe('renderMarkdown golden output', () => {
  for (const flavor of ['github', 'obsidian', 'commonmark'] as const) {
    it(flavor, async () => {
      await expect(renderMarkdown(sampleJson(), { flavor })).toMatchFileSnapshot(`golden/sample.${flavor}.md`);
    });
  }
  it('studyNotes preset through the first version of the edited question', async () => {
    const c = sampleJson();
    await expect(renderMarkdown(c, { path: pathThrough(c, 'a2a'), turns: TURN_PRESETS.studyNotes })).toMatchFileSnapshot(
      'golden/sample.study-notes.u2a.md',
    );
  });
});

function chat(blocks: Conversation['nodes'][string]['blocks'], extra: Partial<Conversation['nodes'][string]> = {}): Conversation {
  return {
    schemaVersion: 1,
    id: 'c1',
    title: 'T',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    sourceUrl: 'https://chatgpt.com/c/c1',
    rootId: 'r',
    activeLeafId: 'a',
    nodes: {
      r: { id: 'r', parentId: null, childIds: ['u'], role: 'system', blocks: [], hidden: true },
      u: { id: 'u', parentId: 'r', childIds: ['a'], role: 'user', blocks: [{ kind: 'markdown', text: 'Q' }], hidden: false },
      a: { id: 'a', parentId: 'u', childIds: [], role: 'assistant', blocks, hidden: false, ...extra },
    },
  };
}

describe('renderMarkdown details', () => {
  it('is deterministic', () => {
    expect(renderMarkdown(sampleJson())).toBe(renderMarkdown(sampleJson()));
  });

  it('converts math only outside code', () => {
    const md = renderMarkdown(chat([{ kind: 'markdown', text: 'Use \\(x\\) for $5\n\n```js\nconst s = "$5 \\(x\\)";\n```' }]));
    expect(md).toContain('Use $x$ for \\$5');
    expect(md).toContain('const s = "$5 \\(x\\)";');
  });

  it('picks a fence longer than any backtick run in code', () => {
    const md = renderMarkdown(chat([{ kind: 'code', lang: 'md', text: 'a\n```\nb', origin: 'fence' }]));
    expect(md).toContain('````md\na\n```\nb\n````');
  });

  it('links exported resources and lists the rest as not included', () => {
    const blocks = [
      { kind: 'image', resource: { fileId: 'f1', name: 'cat (1).png', status: 'ok' }, generated: false },
      { kind: 'image', resource: { fileId: 'f2', status: 'expired' }, generated: true },
      { kind: 'attachment', resource: { fileId: 'f3', name: 'notes.pdf', status: 'pending' } },
    ] as const;
    const md = renderMarkdown(chat([...blocks]), { resourceHref: (r) => (r.status === 'ok' ? `files/${r.name}` : undefined) });
    expect(md).toContain('![Image: cat (1).png](<files/cat (1).png>)');
    expect(md).toContain('*[Generated image: f2, not included (expired)]*');
    expect(md).toContain('*[Attachment: notes.pdf, not included (pending)]*');
  });

  it('keeps unknown content visible as raw JSON', () => {
    const md = renderMarkdown(chat([{ kind: 'unknown', contentType: 'future_widget', raw: { x: 1 } }]));
    expect(md).toContain('**Unknown content (future\\_widget)**, kept as raw data:\n\n```json\n{\n  "x": 1\n}\n```');
  });

  it('says when history was not fetched', () => {
    const c = chat([{ kind: 'markdown', text: 'A' }], { notFetched: 'later-messages' });
    c.nodes.r!.notFetched = 'earlier-messages';
    const gh = renderMarkdown(c);
    expect(gh).toContain('> **Note:** Earlier messages of this chat were not loaded');
    expect(gh).toContain('> **Note:** Later messages under this version exist in the chat but were not loaded.');
    expect(renderMarkdown(c, { flavor: 'obsidian' })).toContain('> [!warning] Incomplete\n> Earlier messages');
  });

  it('shows hidden context only when the turn definition asks for it, and labels it', () => {
    const c = sampleJson();
    expect(renderMarkdown(c)).not.toContain('User prefers short answers.');
    const md = renderMarkdown(c, { turns: { ...TURN_PRESETS.fullArchive, hidden: true } });
    expect(md).toContain('## Context\n\n### Answer\n\n*Hidden context:*\n\nUser prefers short answers.');
  });

  it('escapes the title in front matter and lists each cited URL once per turn', () => {
    const c = chat([
      { kind: 'citation', title: 'A [1]', url: 'https://a.example' },
      { kind: 'citation', url: 'https://a.example' },
      { kind: 'citation', url: 'https://b.example/x y' },
    ]);
    c.title = 'Quote "this"\nand that';
    const md = renderMarkdown(c);
    expect(md).toContain('title: "Quote \\"this\\"\\nand that"');
    expect(md).toContain('# Quote "this" and that');
    expect(md).toContain('**Sources**\n\n1. [A \\[1\\]](https://a.example)\n2. [https://b.example/x y](<https://b.example/x y>)');
  });
});
