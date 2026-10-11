// The compatibility self-test: before any bulk job, fetch one chat the way an export would and say plainly whether
// it worked, or exactly what changed (the adapter's zod issue paths).

import { ChatGptAdapterError, parseChatGptConversation } from '@echoes/adapter-chatgpt-api';
import type { LearnedState } from '../bridge/protocol';
import type { ChatGptClient } from '../chatgpt/client';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  ok: boolean;
  checks: Check[];
}

/** Run the self-test. `chatId` picks the chat to try (the open one); otherwise the newest listed chat is used. */
export async function selfTest(client: ChatGptClient, learned: () => Promise<LearnedState>, chatId?: string): Promise<SelfTestResult> {
  const checks: Check[] = [];
  const done = () => ({ ok: checks.every((c) => c.ok), checks });

  let state: LearnedState;
  try {
    state = await learned();
  } catch (e) {
    checks.push({ name: 'ChatGPT tab', ok: false, detail: `No ChatGPT tab answered (${message(e)}). Open chatgpt.com in a tab and reload it.` });
    return done();
  }
  checks.push({
    name: 'Session',
    ok: state.authSeen,
    detail: state.authSeen ? 'The ChatGPT tab is logged in.' : 'The ChatGPT tab has not loaded any data yet. Log in, or reload the tab.',
  });
  if (!state.authSeen) return done();
  const seen = [state.chatListVariants.length ? 'chat list' : '', ...Object.keys(state.templates).map((k) => FRIENDLY[k] ?? k)].filter(Boolean);
  checks.push({ name: 'Request formats', ok: true, detail: `Learned from the web app: ${seen.join(', ') || 'none yet'}.` });

  let id = chatId;
  try {
    const chats = await client.firstChats();
    checks.push({ name: 'Chat list', ok: true, detail: `Listing works (${chats.length} chats on the first page).` });
    id ??= chats[0]?.id;
  } catch (e) {
    checks.push({ name: 'Chat list', ok: false, detail: message(e) });
  }
  if (!id) {
    checks.push({ name: 'Chat', ok: false, detail: 'No chat to try. Open a chat in the ChatGPT tab and run the check again.' });
    return done();
  }
  try {
    const capture = await client.fetchConversation(id);
    const { conversation, warnings } = parseChatGptConversation(capture);
    const versions = Object.keys(capture.versions ?? {}).length;
    checks.push({
      name: 'Chat',
      ok: true,
      detail:
        `"${conversation.title}" parsed: ${plural(Object.keys(conversation.nodes).length, 'message')}, ${plural(1 + (capture.olderPages?.length ?? 0), 'page')}, ` +
        `${plural(versions, 'turn')} with other versions${warnings.length ? `, ${plural(warnings.length, 'note')} (${[...new Set(warnings.map((w) => w.code))].join(', ')})` : ''}.`,
    });
  } catch (e) {
    const detail =
      e instanceof ChatGptAdapterError
        ? `ChatGPT's format changed: ${e.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
        : message(e);
    checks.push({ name: 'Chat', ok: false, detail });
  }
  if (client.inferred.size) {
    checks.push({
      name: 'Inferred requests',
      ok: true,
      detail: `Not yet seen from the web app, so built from Phase 0 notes: ${[...client.inferred].sort().map((k) => FRIENDLY[k] ?? k).join(', ')}. They worked if the chat check passed.`,
    });
  }
  return done();
}

const FRIENDLY: Record<string, string> = {
  conversation: 'chat',
  messages: 'older pages',
  versions: 'other versions',
  projectSidebar: 'Projects',
  projectChats: 'Project chats',
  fileDownload: 'files',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
