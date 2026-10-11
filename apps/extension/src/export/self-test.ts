// The compatibility self-test: before any bulk job, fetch one chat the way an export would and say plainly whether
// it worked, or exactly what changed (the adapter's zod issue paths).

import { ChatGptAdapterError, parseChatGptConversation } from '@echoes/adapter-chatgpt-api';
import { versionGroups, type Conversation, type Node } from '@echoes/core';
import type { LearnedState } from '../bridge/protocol';
import type { ChatGptClient } from '../chatgpt/client';

export interface Check {
  name: string;
  ok: boolean;
  /** Not run because the chat or account has nothing to test it on. Not an error, but nothing is proven either. */
  skipped?: true;
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
  let parsed: Conversation | undefined;
  let olderPages = 0;
  try {
    const capture = await client.fetchConversation(id);
    const { conversation, warnings } = parseChatGptConversation(capture);
    parsed = conversation;
    olderPages = capture.olderPages?.length ?? 0;
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
  if (parsed) await featureChecks(client, parsed, olderPages, checks);
  await projectCheck(client, checks);
  if (client.inferred.size) {
    checks.push({
      name: 'Inferred requests',
      ok: true,
      detail: `Not yet seen from the web app, so built from Phase 0 notes: ${[...client.inferred].sort().map((k) => FRIENDLY[k] ?? k).join(', ')}. They worked if the chat check passed.`,
    });
  }
  return done();
}

const skipped = (name: string, detail: string): Check => ({ name, ok: true, skipped: true, detail: `Not tested: ${detail}` });

/** What this chat contains, each tried for real or reported as not tested. */
async function featureChecks(client: ChatGptClient, c: Conversation, olderPages: number, checks: Check[]): Promise<void> {
  const blocks = Object.values(c.nodes).flatMap((n) => n.blocks);

  checks.push(
    olderPages
      ? { name: 'Long chat', ok: true, detail: `Older messages came in ${plural(olderPages, 'extra page')}.` }
      : skipped('Long chat', 'this chat fits in one page. Try a chat with many messages.'),
  );

  let edited = 0;
  let regenerated = 0;
  for (const g of versionGroups(c)) {
    // A version can start with hidden messages (tool calls, context); its first visible message says what it is.
    const role = g.nodeIds.map((id) => firstVisible(c, id)?.role).find((r) => r === 'user' || r === 'assistant');
    if (role === 'user') edited++;
    else if (role === 'assistant') regenerated++;
  }
  checks.push(
    edited || regenerated
      ? { name: 'Versions', ok: true, detail: `${plural(edited, 'edited question')} and ${plural(regenerated, 'regenerated answer')} loaded with all their versions.` }
      : skipped('Versions', 'this chat has no edited questions or regenerated answers. Try a chat with "2/2" arrows.'),
  );
  if ((edited || regenerated) && !(edited && regenerated)) {
    checks.push(skipped(edited ? 'Regenerated answers' : 'Edited questions', `this chat has only ${edited ? 'edited questions' : 'regenerated answers'}.`));
  }

  const citations = blocks.filter((b) => b.kind === 'citation').length;
  checks.push(
    citations
      ? { name: 'Sources', ok: true, detail: `${plural(citations, 'cited link')} found.` }
      : skipped('Sources', 'this chat has no cited web sources. Try a chat where ChatGPT searched the web.'),
  );

  const files = blocks.flatMap((b) => (b.kind === 'image' || b.kind === 'attachment' ? [b] : []));
  if (!files.length) {
    checks.push(skipped('Images and files', 'this chat has no images or uploaded files. Try a chat with an image.'));
    return;
  }
  const first = files[0]!;
  try {
    const got = await client.downloadFile(first.resource.fileId);
    checks.push(
      got.ok
        ? { name: 'Images and files', ok: true, detail: `${plural(files.length, 'file')} in this chat; downloaded one (${got.bytes.length} bytes${got.mime ? `, ${got.mime}` : ''}).` }
        : { name: 'Images and files', ok: false, detail: `${plural(files.length, 'file')} in this chat, but the one tried could not be downloaded: ${got.reason}.` },
    );
  } catch (e) {
    checks.push({ name: 'Images and files', ok: false, detail: `Download failed: ${message(e)}` });
  }
}

function firstVisible(c: Conversation, id: string): Node | undefined {
  for (let n = c.nodes[id]; n; n = n.childIds[0] === undefined ? undefined : c.nodes[n.childIds[0]]) {
    if (!n.hidden) return n;
  }
  return undefined;
}

async function projectCheck(client: ChatGptClient, checks: Check[]): Promise<void> {
  try {
    const p = await client.probeProjects();
    if (!p.projects) {
      checks.push(skipped('Projects', 'the Project list works, but this account has no Projects.'));
      return;
    }
    checks.push({
      name: 'Projects',
      ok: true,
      detail: `Listing works (${plural(p.projects, 'Project')} on the first page)${p.chatsPageTried ? ', and so does paging through a Project\'s chats' : ''}.`,
    });
    if (!p.chatsPageTried) checks.push(skipped('Project chat pages', 'no Project has more chats than its first page holds.'));
  } catch (e) {
    checks.push({ name: 'Projects', ok: false, detail: message(e) });
  }
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
