import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activePath, buildTurns, nodesOf, pathThrough, traversals, versionGroups } from '@echoes/core';
import { ROOT_ID, parseChatGptConversation, type ChatGptConversationCapture } from '@echoes/adapter-chatgpt-api';

// Golden tests over anonymized real captures. Any change in the normalized output fails until the golden file is
// reviewed and updated with `pnpm --filter @echoes/adapter-chatgpt-api test -u`.
const load = (name: string): ChatGptConversationCapture =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('project-chat-regenerated (Phase 0 capture, 2026-10-10)', () => {
  const capture = load('project-chat-regenerated');
  const result = parseChatGptConversation(capture);
  const c = result.conversation;

  it('matches the golden output', async () => {
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot('golden/project-chat-regenerated.echoes.json');
  });

  it('rebuilds the active path from three pages and the regenerated answer as a version', () => {
    const path = activePath(c);
    expect(path).toHaveLength(1 + 35 + 46 + 48);
    expect(c.activeLeafId).toBe((capture.conversation as { current_node: string }).current_node);
    expect(c.projectId).toMatch(/^g-p-/);

    const groups = versionGroups(c);
    expect(groups).toHaveLength(1);
    const question = c.nodes[groups[0]!.parentId]!;
    expect(question.role).toBe('user');
    expect(traversals(c)).toHaveLength(2);

    // The original answer (written first) is version 1 and carries the hidden context the paged API leaves out.
    const [original, regenerated] = question.childIds;
    expect(path).toContain(regenerated);
    const originalPath = pathThrough(c, original!);
    expect(originalPath.slice(0, path.indexOf(question.id) + 1)).toEqual(path.slice(0, path.indexOf(question.id) + 1));
    expect(nodesOf(c, originalPath).some((n) => n.hidden)).toBe(true);
    // The fork is on the last turn, so the version is complete.
    expect(Object.values(c.nodes).some((n) => n.notFetched === 'later-messages')).toBe(false);
  });

  it('reports only that older history was not fetched', () => {
    expect(result.warnings.map((w) => w.code)).toEqual(['earlier-messages-not-fetched']);
    expect(c.nodes[ROOT_ID]!.notFetched).toBe('earlier-messages');
  });

  it('gives one turn per question with the answer last', () => {
    const turns = buildTurns(nodesOf(c, activePath(c)));
    expect(turns).toHaveLength(16);
    for (const t of turns.filter((t) => t.question)) expect(t.responses.at(-1)!.blocks.some((b) => b.kind === 'markdown')).toBe(true);
  });

  it('keeps raw formats out of the model: no raw thoughts, no citation markers', () => {
    const json = JSON.stringify(c);
    expect(json).not.toContain('RAW THOUGHT CONTENT');
    expect(json).not.toMatch(/[-]/);
    expect(json).toContain('"kind":"citation"');
    expect(json).toContain('"kind":"reasoning"');
  });
});
