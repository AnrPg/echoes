import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EchoesValidationError, conversationJsonSchema, parseConversation, safeParseConversation } from '@echoes/core';
import { sampleJson } from './helpers.ts';

function issuesOf(input: unknown): string[] {
  const r = safeParseConversation(input);
  return r.success ? [] : r.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('parseConversation', () => {
  it('accepts the sample', () => {
    const c = parseConversation(sampleJson());
    expect(c.nodes['a2b2']!.blocks).toHaveLength(5);
  });

  it('keeps unknown blocks with their raw payload', () => {
    const c = parseConversation(sampleJson());
    expect(c.nodes['a2b2']!.blocks.at(-1)).toEqual({ kind: 'unknown', contentType: 'future_widget', raw: { x: 1 } });
  });

  it('rejects field-level problems with paths', () => {
    const c = sampleJson() as any;
    c.schemaVersion = 2;
    c.nodes.u1.role = 'moderator';
    c.nodes.a1.blocks.push({ kind: 'video' });
    c.createdAt = '2026-10-01 09:00';
    const issues = issuesOf(c);
    expect(issues.some((i) => i.startsWith('schemaVersion'))).toBe(true);
    expect(issues.some((i) => i.startsWith('nodes.u1.role'))).toBe(true);
    expect(issues.some((i) => i.startsWith('nodes.a1.blocks.2'))).toBe(true);
    expect(issues.some((i) => i.startsWith('createdAt'))).toBe(true);
  });

  it('accepts notFetched markers and rejects unknown ones', () => {
    const c = sampleJson() as any;
    c.nodes.root.notFetched = 'earlier-messages';
    c.nodes.a2b2.notFetched = 'later-messages';
    expect(issuesOf(c)).toEqual([]);
    c.nodes.a1.notFetched = 'some';
    expect(issuesOf(c).some((i) => i.startsWith('nodes.a1.notFetched'))).toBe(true);
  });

  it('accepts offsets in timestamps and a missing node time', () => {
    const c = sampleJson() as any;
    c.updatedAt = '2026-10-01T12:05:00+03:00';
    delete c.nodes.u1.createdAt;
    expect(issuesOf(c)).toEqual([]);
  });

  it.each<[string, (c: any) => void, string]>([
    ['key mismatch', (c) => (c.nodes.u1.id = 'zz'), 'nodes.u1.id: id "zz" does not match its key "u1"'],
    ['missing child', (c) => c.nodes.a2a.childIds.push('ghost'), 'nodes.a2a.childIds.0: child "ghost" does not exist'],
    ['duplicate child', (c) => c.nodes.u2b.childIds.push('a2b1'), 'nodes.u2b.childIds.2: duplicate child "a2b1"'],
    ['wrong parent', (c) => (c.nodes.a2a.parentId = 'u2b'), 'nodes.a2a.parentId: expected parent "u2a", got "u2b"'],
    ['root with parent', (c) => (c.nodes.root.parentId = 'u1'), 'nodes.root.parentId: root node must have parentId null'],
    ['second root', (c) => (c.nodes.u2a.parentId = null), 'nodes.u2a.parentId: only the root may have parentId null'],
    ['missing root', (c) => (c.rootId = 'nope'), 'rootId: root "nope" does not exist'],
    ['active leaf not a leaf', (c) => (c.activeLeafId = 'u2b'), 'activeLeafId: node "u2b" has children, so it is not a leaf'],
    [
      'orphan cycle',
      (c) => {
        c.nodes.x = { id: 'x', parentId: 'y', childIds: ['y'], role: 'user', blocks: [], hidden: false };
        c.nodes.y = { id: 'y', parentId: 'x', childIds: ['x'], role: 'user', blocks: [], hidden: false };
      },
      'nodes.x: not reachable from the root',
    ],
  ])('reports %s', (_name, mutate, expected) => {
    const c = sampleJson();
    mutate(c);
    expect(issuesOf(c)).toContain(expected);
  });

  it('checks the lineage parent snapshot too', () => {
    const c = sampleJson() as any;
    const snapshot = sampleJson() as any;
    snapshot.activeLeafId = 'a1';
    c.lineage = {
      parentConversationId: 'p', forkNodeId: 'a1', childConversationId: c.id,
      detectedAt: '2026-10-01T09:10:00Z', evidence: 'recorded', confidence: 1, parentSnapshot: snapshot,
    };
    expect(issuesOf(c)).toEqual(['lineage.parentSnapshot.activeLeafId: node "a1" has children, so it is not a leaf']);
  });

  it('throws EchoesValidationError listing every issue', () => {
    const c = sampleJson() as any;
    c.rootId = 'nope';
    c.activeLeafId = 'gone';
    try {
      parseConversation(c);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EchoesValidationError);
      expect((e as EchoesValidationError).issues.length).toBeGreaterThanOrEqual(2);
      expect((e as Error).message).toMatch(/rootId: root "nope" does not exist/);
    }
  });
});

describe('published JSON Schema', () => {
  it('matches the zod schemas (run `pnpm --filter @echoes/core schema` after changing them)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../schemas/conversation.v1.schema.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(conversationJsonSchema());
  });
});
