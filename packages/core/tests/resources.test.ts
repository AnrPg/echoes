import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeExtension, parseConversation, planResources, renderResourceIndex, resourceManifest, resourceText, type Conversation } from '@echoes/core';

const showcase = (): Conversation =>
  parseConversation(JSON.parse(readFileSync(new URL('./fixtures/render-showcase.json', import.meta.url), 'utf8')));

describe('planResources', () => {
  it('sorts files, code, tool output, canvas and links into one folder per turn', () => {
    const plan = planResources(showcase());
    expect(plan.items.map((i) => [i.kind, i.path])).toEqual([
      ['file', 'turn-01/board (1).png'],
      ['file', 'turn-01/notes.pdf'],
      ['code', 'turn-01/tool-code-1.py'],
      ['toolOutput', 'turn-01/tool-output-1.txt'],
      ['file', 'turn-01/plot.png'],
      ['code', 'turn-01/code-2.sh'],
      ['links', 'turn-01/links.md'],
      ['file', 'turn-02/file_gen'],
      ['canvas', 'turn-02/Parabola notes.md'],
      ['code', 'turn-03/code-1.md'],
    ]);
  });

  it('writes code byte for byte, links with their kind, canvas with its title', () => {
    const items = planResources(showcase()).items;
    expect(resourceText(items.find((i) => i.path.endsWith('code-2.sh'))!)).toBe('echo "$ROOTS"\n');
    // The cited link also appears in the text: one entry, marked as a source, with the citation's title.
    expect(resourceText(items.find((i) => i.kind === 'links')!)).toBe(
      '- Source: [Roots of x² − 4](https://example.org/roots)\n- Source: [https://example.org/a b(c)](https://example.org/a%20b%28c%29)\n',
    );
    expect(resourceText(items.find((i) => i.kind === 'canvas')!)).toBe('# Parabola notes\n\nThe vertex is at \\((0,-4)\\).\n');
  });

  it('follows the turn selection and the turn definition', () => {
    expect(planResources(showcase(), { selectedTurns: [2] }).items.map((i) => i.turn)).toEqual([2, 2]);
    const noFiles = planResources(showcase(), { turns: { questions: true, answers: true, reasoning: false, tools: false, citations: false, images: false, attachments: false, hidden: false } });
    expect(noFiles.items.filter((i) => i.kind === 'file')).toEqual([]);
    expect(noFiles.items.some((i) => i.kind === 'code' && i.origin === 'tool')).toBe(false);
  });

  it('says what happened to every file in index.md and resources.json', async () => {
    const plan = planResources(showcase());
    const outcome = (i: { resource: { fileId: string; status: string } }) =>
      i.resource.status === 'expired' ? 'expired' : i.resource.status === 'sandbox-gone' ? 'sandbox-gone' : i.resource.fileId === 'file_gen' ? 'failed' : 'saved';
    const index = renderResourceIndex(plan, outcome as never);
    await expect(index).toMatchFileSnapshot('golden/showcase.resources.md');
    expect(index).toContain('- Generated image: file\\_gen (could not be downloaded)');
    const manifest = JSON.parse(resourceManifest(plan, outcome as never));
    expect(manifest).toMatchObject({ format: 'echoes-resources', formatVersion: 1, conversationId: plan.conversationId });
    expect(manifest.items[1]).toEqual({ kind: 'file', turn: 1, path: 'turn-01/notes.pdf', label: 'Attachment', fileId: expect.any(String), name: 'notes.pdf', outcome: 'expired' });
  });

  it('a chat without resources says so', () => {
    const c = showcase();
    for (const n of Object.values(c.nodes)) n.blocks = n.blocks.filter((b) => b.kind === 'reasoning');
    expect(renderResourceIndex(planResources(c))).toContain('This chat has no files, code, canvas documents or links.');
  });
});

describe('codeExtension', () => {
  it('maps common languages and falls back to .txt', () => {
    expect([codeExtension('Python'), codeExtension('ts'), codeExtension('c++'), codeExtension(undefined), codeExtension('brainfuck')]).toEqual(['.py', '.ts', '.cpp', '.txt', '.txt']);
  });
});
