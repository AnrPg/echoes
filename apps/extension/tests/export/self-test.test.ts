import { describe, expect, it } from 'vitest';
import { selfTest } from '../../src/export/self-test';
import { harness } from '../bridge/harness';
import { IMAGE_CHAT_ID, PLAIN_CHAT_ID, PROJECT_CHAT_ID, state } from '../fake-chatgpt';

describe('selfTest', () => {
  it('passes on a working tab and names what was inferred', async () => {
    const h = await harness();
    const r = await selfTest(h.client, () => h.link.learned(), PROJECT_CHAT_ID);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual([
      'Session', 'Request formats', 'Chat list', 'Chat', 'Long chat', 'Versions', 'Edited questions', 'Sources', 'Images and files', 'Projects', 'Inferred requests',
    ]);
    expect(r.checks[3]!.detail).toMatch(/3 pages, 1 turn with other versions/);
    const by = (name: string) => r.checks.find((c) => c.name === name)!;
    expect(by('Long chat')).toMatchObject({ ok: true, detail: 'Older messages came in 2 extra pages.' });
    expect(by('Versions')).toMatchObject({ ok: true, detail: '0 edited questions and 1 regenerated answer loaded with all their versions.' });
    expect(by('Edited questions')).toMatchObject({ skipped: true, detail: 'Not tested: this chat has only regenerated answers.' });
    expect(by('Projects').detail).toMatch(/^Listing works \(1 Project on the first page\), and so does paging/);
    expect(r.checks.at(-1)!.detail).toContain('older pages, other versions');
  });

  it('downloads one file when the chat has images', async () => {
    const h = await harness();
    const r = await selfTest(h.client, () => h.link.learned(), IMAGE_CHAT_ID);
    expect(r.checks.find((c) => c.name === 'Images and files')).toMatchObject({ ok: true, detail: expect.stringMatching(/^1 file in this chat; downloaded one \(\d+ bytes/) });
  });

  it('says loudly what it could not test on a plain chat', async () => {
    const h = await harness();
    const r = await selfTest(h.client, () => h.link.learned(), PLAIN_CHAT_ID);
    expect(r.ok).toBe(true);
    expect(r.checks.filter((c) => c.skipped).map((c) => c.name)).toEqual(['Long chat', 'Versions', 'Sources', 'Images and files']);
    expect(r.checks.filter((c) => c.skipped).every((c) => c.detail.startsWith('Not tested: '))).toBe(true);
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
