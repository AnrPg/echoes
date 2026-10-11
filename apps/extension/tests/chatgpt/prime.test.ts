import { describe, expect, it } from 'vitest';
import { emptyLearnedState, learn, type LearnedState } from '../../src/bridge/protocol';
import { ensureChatTemplate } from '../../src/chatgpt/prime';

const ORIGIN = 'https://chatgpt.com';

/** A ChatGPT tab that sits on a Project page until Echoes opens a chat in it. */
function tab() {
  let state = emptyLearnedState();
  const events: string[] = [];
  return {
    events,
    learned: async (): Promise<LearnedState> => state,
    open: async (url: string) => {
      events.push(`open ${url}`);
      state = emptyLearnedState();
      learn(state, new URL(`${ORIGIN}/backend-api/conversations/c1?num_turns=12`), true); // the app loads the chat
      return async () => void events.push('back');
    },
  };
}

describe('ensureChatTemplate', () => {
  it('opens one chat in the ChatGPT tab when no chat was loaded there, then goes back', async () => {
    const t = tab();
    expect(await ensureChatTemplate({ learned: t.learned, open: t.open, sleep: async () => {}, chatUrl: `${ORIGIN}/c/c1` })).toBe('learned');
    expect(t.events).toEqual([`open ${ORIGIN}/c/c1`, 'back']);
  });

  it('does nothing when the template is known', async () => {
    const t = tab();
    await t.open('x');
    t.events.length = 0;
    expect(await ensureChatTemplate({ learned: t.learned, open: t.open, sleep: async () => {}, chatUrl: 'y' })).toBe('had');
    expect(t.events).toEqual([]);
  });

  it('gives up with a clear message, and still goes back, when the chat never loads', async () => {
    const events: string[] = [];
    const p = ensureChatTemplate({
      learned: async () => emptyLearnedState(),
      open: async () => async () => void events.push('back'),
      sleep: async () => {},
      chatUrl: 'y',
      timeoutMs: 2000,
    });
    await expect(p).rejects.toThrow(/did not load/);
    expect(events).toEqual(['back']);
  });
});
