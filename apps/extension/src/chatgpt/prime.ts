// Echoes copies how the ChatGPT web app requests a chat instead of guessing parameters, so it needs to have seen the
// app load one chat. Before a bulk export from a page that loaded no chat (a Project page, the home page), Echoes opens
// the first chat of the export in the ChatGPT tab itself, waits until the app's request was seen, and goes back. The
// template is then remembered (see bridge/remembered.ts), so this happens once, not per chat or per export.

import type { LearnedState } from '../bridge/protocol';

export interface PrimeOptions {
  learned: () => Promise<LearnedState>;
  /** Show this chat in the ChatGPT tab. Returns how to go back to what the tab showed before. */
  open: (chatUrl: string) => Promise<() => Promise<void>>;
  sleep: (ms: number) => Promise<void>;
  chatUrl: string;
  /** Default 30 s: a reload plus the app's first chat request. */
  timeoutMs?: number;
  pollMs?: number;
}

const hasChatTemplate = (s: LearnedState) => s.templates.conversation !== undefined;

/** `'had'` when nothing needed doing, `'learned'` after opening the chat; throws when the app's request never came. */
export async function ensureChatTemplate(o: PrimeOptions): Promise<'had' | 'learned'> {
  if (hasChatTemplate(await o.learned())) return 'had';
  const back = await o.open(o.chatUrl);
  try {
    const poll = o.pollMs ?? 500;
    for (let waited = 0; waited < (o.timeoutMs ?? 30_000); waited += poll) {
      await o.sleep(poll);
      // While the tab reloads, the bridge is briefly unreachable; keep waiting.
      const state = await o.learned().catch(() => undefined);
      if (state && hasChatTemplate(state)) return 'learned';
    }
    throw new Error('Echoes opened a chat in the ChatGPT tab to see how ChatGPT loads chats, but the chat did not load. Check that you are logged in, then try again.');
  } finally {
    await back();
  }
}
