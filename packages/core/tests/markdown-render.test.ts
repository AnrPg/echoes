import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_FLAVORS,
  TURN_PRESETS,
  parseConversation,
  pathThrough,
  renderJson,
  renderMarkdown,
  type Conversation,
  type Resource,
} from '@echoes/core';
import { sampleJson } from './helpers.ts';

// Golden tests: any change in rendered output fails until the golden file is reviewed and updated (`vitest -u`).
const showcase = (): Conversation =>
  parseConversation(JSON.parse(readFileSync(new URL('./fixtures/render-showcase.json', import.meta.url), 'utf8')));

const files = (r: Resource) => `files/${r.name ?? r.fileId}`;

describe('renderMarkdown golden output', () => {
  for (const flavor of MARKDOWN_FLAVORS) {
    it(`showcase, ${flavor}`, async () => {
      const md = renderMarkdown(showcase(), { flavor, resolveResource: files });
      await expect(md).toMatchFileSnapshot(`golden/showcase.${flavor}.md`);
    });
  }

  it('sample, github, study notes, through the first version of the edited question', async () => {
    const c = parseConversation(sampleJson());
    const md = renderMarkdown(c, { path: pathThrough(c, 'u2a'), turns: TURN_PRESETS.studyNotes });
    await expect(md).toMatchFileSnapshot('golden/sample.u2a.github.md');
  });
});

describe('renderMarkdown behavior', () => {
  it('is deterministic and ends with one newline', () => {
    const a = renderMarkdown(showcase(), { flavor: 'obsidian' });
    expect(renderMarkdown(showcase(), { flavor: 'obsidian' })).toBe(a);
    expect(a.endsWith('\n') && !a.endsWith('\n\n')).toBe(true);
  });

  it('defaults to the active path and the full archive preset, without hidden context', () => {
    const md = renderMarkdown(showcase());
    expect(md).toContain('Show a fence inside a fence');
    expect(md).not.toContain('Thanks\n');
    expect(md).not.toContain('Prefers SI units');
    expect(md).toContain('_Version 2 of 2 (edited question)_');
  });

  it('shows hidden context as turn 0 only when the turn definition asks for it', () => {
    const md = renderMarkdown(showcase(), { turns: { ...TURN_PRESETS.fullArchive, hidden: true } });
    expect(md).toContain('## Context\n\n### Context\n\nPrefers SI units.');
  });

  it('moves a version note to the next rendered node when its own node is filtered out', () => {
    const c = showcase();
    c.nodes['u3b'] = { ...c.nodes['u3b']!, hidden: true };
    expect(renderMarkdown(c)).toContain('### Assistant\n\n_Version 2 of 2 (edited question)_\n\n````markdown');
  });

  it('states gaps the adapter flagged', () => {
    const c = showcase();
    expect(renderMarkdown(c)).toContain('Earlier messages in this chat were not loaded');
    const old = renderMarkdown(c, { path: pathThrough(c, 'u3a') });
    expect(old.trimEnd().endsWith('> Later messages under this version were not loaded.')).toBe(true);
  });

  it('never links expired or vanished files, even with a resolver', () => {
    const md = renderMarkdown(showcase(), { resolveResource: files });
    expect(md).toContain('_\\[Attachment expired: notes.pdf\\]_');
    expect(md).toContain('_\\[File no longer available: plot.png\\]_');
    expect(md).toContain('![board (1).png](files/board%20%281%29.png)');
  });

  it('keeps unknown content visible with its raw JSON', () => {
    const md = renderMarkdown(showcase(), { flavor: 'github' });
    expect(md).toContain('`future_widget`');
    expect(md).toContain('"content_type": "future_widget"');
  });

  it('respects the turn definition: answers only drops questions, reasoning and tools', () => {
    const md = renderMarkdown(showcase(), { turns: TURN_PRESETS.answersOnly });
    expect(md).not.toContain('### User');
    expect(md).not.toContain('Reasoning summary');
    expect(md).not.toContain('Tool call');
    expect(md).not.toContain('**Sources**');
  });

  it('lets a block renderer override or wrap the default', () => {
    const md = renderMarkdown(showcase(), {
      blockRenderers: {
        unknown: () => '',
        canvas: (b, ctx) => `<!-- canvas -->\n${ctx.renderDefault()}`,
        markdown: (b) => (b.text === 'Thanks! Show a fence inside a fence.' ? 'REPLACED' : undefined),
      },
    });
    expect(md).not.toContain('future_widget');
    expect(md).toContain('<!-- canvas -->\n**Canvas: Parabola notes**');
    expect(md).toContain('REPLACED');
  });

  it('names the source of a branched chat in the front matter, with its evidence', () => {
    const c = showcase();
    c.lineage = { parentConversationId: 'parent-1', forkNodeId: 'm-7', childConversationId: c.id, detectedAt: '2026-10-10T20:32:26.000Z', evidence: 'recorded', confidence: 1 };
    const md = renderMarkdown(c);
    expect(md).toContain('branched_from: "parent-1"\nbranched_at_message: "m-7"\nbranch_evidence: "recorded"\necho');
  });

  it('uses custom labels and no front matter for commonmark by default', () => {
    const md = renderMarkdown(showcase(), { flavor: 'commonmark', labels: { user: 'Me', assistant: 'ChatGPT' } });
    expect(md.startsWith('# Showcase')).toBe(true);
    expect(md).toContain('### Me');
    expect(md).toContain('### ChatGPT');
  });
});

describe('renderJson', () => {
  it('round-trips through parseConversation', () => {
    const c = showcase();
    const json = renderJson(c);
    expect(json.endsWith('}\n')).toBe(true);
    expect(parseConversation(JSON.parse(json))).toEqual(c);
  });

  it('refuses an invalid conversation', () => {
    const c = showcase();
    expect(() => renderJson({ ...c, activeLeafId: 'missing' })).toThrow(/Invalid Echoes conversation/);
  });
});
