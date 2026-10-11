import { describe, expect, it } from 'vitest';
import { selfTest } from '../../src/export/self-test';
import { harness } from '../bridge/harness';
import { PLAIN_CHAT_ID, PROJECT_CHAT_ID, state } from '../fake-chatgpt';

describe('selfTest', () => {
  it('passes on a working tab and names what was inferred', async () => {
    const h = await harness();
    const r = await selfTest(h.client, () => h.link.learned(), PROJECT_CHAT_ID);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(['Session', 'Request formats', 'Chat list', 'Chat', 'Inferred requests']);
    expect(r.checks[3]!.detail).toMatch(/3 pages, 1 turn with other versions/);
    expect(r.checks[4]!.detail).toContain('older pages, other versions');
  });

  it('asks to log in when the tab has no session', async () => {
    const h = await harness({ authenticated: false });
    const r = await selfTest(h.client, () => h.link.learned());
    expect(r.ok).toBe(false);
    expect(r.checks.at(-1)).toMatchObject({ name: 'Session', ok: false });
  });

  it('reports exactly what changed when ChatGPT changes its format', async () => {
    const h = await harness();
    const msg = state.chats[PLAIN_CHAT_ID]!.messages[0]! as any;
    const role = msg.author.role;
    msg.author.role = 'moderator';
    try {
      const r = await selfTest(h.client, () => h.link.learned(), PLAIN_CHAT_ID);
      expect(r.ok).toBe(false);
      expect(r.checks.find((c) => c.name === 'Chat')!.detail).toMatch(/^ChatGPT's format changed: messages\.0\.author\.role/);
    } finally {
      msg.author.role = role;
    }
  });

  it('reports a missing ChatGPT tab', async () => {
    const h = await harness();
    const r = await selfTest(h.client, () => Promise.reject(new Error('no ChatGPT tab')));
    expect(r.checks).toEqual([{ name: 'ChatGPT tab', ok: false, detail: expect.stringContaining('Open chatgpt.com') }]);
  });
});
