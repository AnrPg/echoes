import type { Scheduler } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { emptyLearnedState, learn } from '../../src/bridge/protocol';
import { ChatGptClient, type BridgeResponse, type ListProgress } from '../../src/chatgpt/client';

const ORIGIN = 'https://chatgpt.com';

const chat = (id: string) => ({ id, title: `Chat ${id}`, create_time: '2026-10-01T00:00:00Z', update_time: '2026-10-02T00:00:00Z' });
const project = (id: string, chats: string[], cursor: string | null) => ({
  gizmo: { gizmo: { id, display: { name: `Project ${id}` } } },
  conversations: { items: chats.map(chat), cursor },
});

// The shape of the 2026-10-11 capture: the sidebar's first page carries each Project's first chats; Projects on later
// pages come with no chats and no cursor, although they have chats.
const RESPONSES: Record<string, unknown> = {
  '/backend-api/gizmos/snorlax/sidebar': { items: [project('g-p-a', ['a1'], 'ca'), project('g-p-b', ['b1'], null)], cursor: 's2' },
  '/backend-api/gizmos/snorlax/sidebar?cursor=s2': { items: [project('g-p-c', [], null)], cursor: null },
  '/backend-api/gizmos/g-p-a/conversations?cursor=ca': { items: [chat('a2')], cursor: null },
  '/backend-api/gizmos/g-p-c/conversations': { items: [chat('c1')], cursor: 'cc' },
  '/backend-api/gizmos/g-p-c/conversations?cursor=cc': { items: [chat('c2')], cursor: null },
};

function client() {
  const log: string[] = [];
  const scheduler = {
    request: async ({ url }: { url: string }) => {
      const u = new URL(url);
      const key = u.pathname + u.search;
      log.push(key);
      if (!(key in RESPONSES)) throw new Error(`unexpected request ${key}`);
      return { status: 200, headers: new Headers(), body: JSON.stringify(RESPONSES[key]) };
    },
  } as unknown as Scheduler<BridgeResponse>;
  const learned = emptyLearnedState();
  learn(learned, new URL(`${ORIGIN}/backend-api/gizmos/snorlax/sidebar`), true);
  learn(learned, new URL(`${ORIGIN}/backend-api/gizmos/g-p-x/conversations`), true);
  return { log, c: new ChatGptClient({ origin: ORIGIN, scheduler, learned: async () => learned }) };
}

describe('Project chat lists', () => {
  it('lists the chats of Projects past the sidebar first page from their own first page', async () => {
    const { c } = client();
    const progress: ListProgress[] = [];
    const projects = await c.listProjects((p) => progress.push(p));
    expect(projects.map((p) => [p.id, p.chats.map((x) => x.id)])).toEqual([
      ['g-p-a', ['a1', 'a2']],
      ['g-p-b', ['b1']],
      ['g-p-c', ['c1', 'c2']],
    ]);
    expect(progress.at(-1)).toEqual({ projectsDone: 3, projects: 3, chats: 5 });
  });

  it('on a Project page lists only that Project, without walking the others', async () => {
    const { c, log } = client();
    const p = await c.projectWithChats((p) => p.id === 'g-p-c');
    expect(p?.chats.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(log.filter((l) => l.includes('g-p-a') || l.includes('g-p-b'))).toEqual([]);
  });
});
