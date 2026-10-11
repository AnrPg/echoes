import { parseChatGptConversation, parseNewBranch } from '@echoes/adapter-chatgpt-api';
import { HttpError } from '@echoes/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyPath, emptyLearnedState, learn, refuseUrl } from '../../src/bridge/protocol';
import { MissingTemplateError, buildUrl, chatListUrls } from '../../src/chatgpt/urls';
import { IMAGE_BYTES, IMAGE_CHAT_ID, ORIGIN, PLAIN_CHAT_ID, PROJECT_CHAT_ID, PROJECT_ID, state } from '../fake-chatgpt';
import { FakeWindow, harness } from './harness';
import { installBridge } from '../../src/bridge/page';

describe('protocol', () => {
  it('classifies only the endpoints Echoes reads', () => {
    expect(classifyPath('/backend-api/conversations')).toEqual({ kind: 'chatList' });
    expect(classifyPath('/backend-api/conversations/abc-1')).toEqual({ kind: 'conversation', id: 'abc-1' });
    expect(classifyPath('/backend-api/conversations/abc-1/messages')).toEqual({ kind: 'messages', id: 'abc-1' });
    expect(classifyPath('/backend-api/conversations/abc-1/versions')).toEqual({ kind: 'versions', id: 'abc-1' });
    expect(classifyPath('/backend-api/gizmos/snorlax/sidebar')).toEqual({ kind: 'projectSidebar' });
    expect(classifyPath('/backend-api/gizmos/g-p-1/conversations')).toEqual({ kind: 'projectChats', id: 'g-p-1' });
    expect(classifyPath('/backend-api/files/download/file_1')).toEqual({ kind: 'fileDownload', id: 'file_1' });
    expect(classifyPath('/backend-api/estuary/content')).toEqual({ kind: 'fileContent' });
    expect(classifyPath('/backend-api/conversation')).toBeUndefined(); // sending a message: never
    expect(classifyPath('/backend-api/conversation/new_branch')).toBeUndefined();
    expect(classifyPath('/backend-api/me')).toBeUndefined();
  });

  it('refuses other origins and endpoints', () => {
    expect(refuseUrl(`${ORIGIN}/backend-api/conversations?offset=0`, ORIGIN)).toBeUndefined();
    expect(refuseUrl('https://evil.example/backend-api/conversations', ORIGIN)).toMatch(/other origin/);
    expect(refuseUrl(`${ORIGIN}/backend-api/accounts/check`, ORIGIN)).toMatch(/not an Echoes endpoint/);
    expect(refuseUrl('nope', ORIGIN)).toBe('not a URL');
  });

  it('learns query templates; chat list variants by parameter names', () => {
    const s = emptyLearnedState();
    learn(s, new URL(`${ORIGIN}/backend-api/conversations/x?include_has_versions=true&num_turns=12`), true);
    learn(s, new URL(`${ORIGIN}/backend-api/conversations?offset=0&limit=28&conversation_origin=tpp`), true);
    learn(s, new URL(`${ORIGIN}/backend-api/conversations?offset=28&limit=28&conversation_origin=tpp`), true);
    learn(s, new URL(`${ORIGIN}/backend-api/conversations?offset=0&limit=28&exclude_conversation_origin=tpp`), true);
    expect(s.authSeen).toBe(true);
    expect(s.templates.conversation).toEqual([['include_has_versions', 'true'], ['num_turns', '12']]);
    expect(s.chatListVariants).toHaveLength(2);
    expect(s.chatListVariants[0]).toEqual([['offset', '28'], ['limit', '28'], ['conversation_origin', 'tpp']]);
  });
});

describe('buildUrl', () => {
  const s = emptyLearnedState();
  learn(s, new URL(`${ORIGIN}/backend-api/conversations/x?include_has_versions=true&num_turns=12`), true);

  it('copies the learned query and sets only Echoes paging parameters', () => {
    expect(buildUrl(ORIGIN, s, 'conversation', 'c 1')).toEqual({ url: `${ORIGIN}/backend-api/conversations/c%201?include_has_versions=true&num_turns=12`, source: 'learned' });
    expect(buildUrl(ORIGIN, s, 'messages', 'c1', { before: 'm9' })).toEqual({
      url: `${ORIGIN}/backend-api/conversations/c1/messages?include_has_versions=true&num_turns=12&before=m9`,
      source: 'inferred',
    });
    expect(buildUrl(ORIGIN, s, 'versions', 'c1', { message_id: 'm1' })).toEqual({ url: `${ORIGIN}/backend-api/conversations/c1/versions?message_id=m1`, source: 'inferred' });
  });

  it('replaces a learned paging value instead of sending it twice', () => {
    const t = emptyLearnedState();
    learn(t, new URL(`${ORIGIN}/backend-api/conversations/x/messages?before=old&num_turns=5`), true);
    expect(buildUrl(ORIGIN, t, 'messages', 'c1', { before: 'new' }).url).toBe(`${ORIGIN}/backend-api/conversations/c1/messages?num_turns=5&before=new`);
  });

  it('never invents a template it has not seen, and says how to fix it', () => {
    expect(() => buildUrl(ORIGIN, emptyLearnedState(), 'conversation', 'c1')).toThrow(MissingTemplateError);
    expect(() => buildUrl(ORIGIN, emptyLearnedState(), 'messages', 'c1')).toThrow(/Open any chat/);
    expect(() => chatListUrls(ORIGIN, emptyLearnedState(), 0)).toThrow(/sidebar/);
  });
});

describe('page bridge', () => {
  it('learns from the app, replays its headers for Echoes requests, and never posts the token', async () => {
    const h = await harness();
    expect(h.bridge.state().authSeen).toBe(true);
    const r = await h.link.call({ op: 'fetch', url: `${ORIGIN}/backend-api/conversations/${PLAIN_CHAT_ID}?num_turns=1` });
    expect(r).toMatchObject({ op: 'fetch', status: 200, headers: { 'content-type': 'application/json' } });
    expect(JSON.stringify(h.win.posted)).not.toContain('test-token');
  });

  it('refuses URLs outside the allowlist and reports a missing session', async () => {
    const h = await harness();
    expect(await h.link.call({ op: 'fetch', url: `${ORIGIN}/backend-api/conversation` })).toMatchObject({ op: 'error', message: expect.stringMatching(/^refused/) });
    const anon = await harness({ authenticated: false });
    expect(await anon.link.call({ op: 'fetch', url: `${ORIGIN}/backend-api/conversations` })).toMatchObject({ op: 'error', message: expect.stringMatching(/^no-session/) });
  });

  it('a missing session pauses the queue (401) instead of failing the export', async () => {
    const anon = await harness({ authenticated: false });
    const events: string[] = [];
    anon.scheduler.subscribe((e) => events.push(e.type));
    const p = anon.client.listChats();
    await new Promise((r) => setTimeout(r, 20));
    expect(anon.scheduler.state).toBe('paused');
    expect(events).toContain('paused');
    anon.scheduler.cancel();
    await expect(p).rejects.toThrow();
  });

  it('records "Branch in new chat" from the app\'s own request and response', async () => {
    const answer = { conversation: { conversation_id: 'child-1', current_node: 'leaf', create_time: 1.5, mapping: {} } };
    const w = new FakeWindow();
    w.fetch = async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    installBridge(w, { origin: ORIGIN, now: () => 42 });
    const res = await w.fetch('/backend-api/conversation/new_branch', { method: 'POST', body: JSON.stringify({ conversation_id: 'parent-1', message_id: 'm-7' }) });
    expect(await res.json()).toEqual(answer); // the page still reads its own response
    await new Promise((r) => setTimeout(r, 10));
    const ev = w.posted.find((m: any) => m.op === 'branch') as any;
    expect(ev).toMatchObject({ t: 42 });
    expect(parseNewBranch(ev.request, ev.response)).toEqual({ parentConversationId: 'parent-1', forkMessageId: 'm-7', childConversationId: 'child-1' });
  });

  it('the relay forwards branch events to the service worker', async () => {
    const h = await harness();
    h.win.postMessage({ channel: 'echoes-v1-bridge', dir: 'from-page', op: 'branch', t: 5, request: { a: 1 }, response: { b: 2 } });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.branchMessages).toEqual([{ type: 'echoes:branch', t: 5, request: { a: 1 }, response: { b: 2 } }]);
  });
});

describe('ChatGptClient through the bridge', () => {
  it('fetches a paged chat with its versions, exactly what the adapter needs', async () => {
    const { client } = await harness();
    state.log.length = 0;
    const capture = await client.fetchConversation(PROJECT_CHAT_ID);
    expect(capture.olderPages).toHaveLength(2);
    expect(Object.keys(capture.versions ?? {})).toEqual(['00000000-0000-4000-8000-000000000176']);
    expect(state.log.map((l) => l.split('?')[0]!.replace(PROJECT_CHAT_ID, ':id'))).toEqual([
      '/backend-api/conversations/:id',
      '/backend-api/conversations/:id/messages',
      '/backend-api/conversations/:id/messages',
      '/backend-api/conversations/:id/versions',
    ]);
    expect(state.log[0]).toContain('include_has_versions=true&num_turns=12'); // the app's own values
    expect([...client.inferred].sort()).toEqual(['messages', 'versions']);
    const fixture = JSON.parse(readFileSync(new URL('../../../../packages/adapter-chatgpt-api/fixtures/project-chat-regenerated.json', import.meta.url), 'utf8'));
    const { conversation } = parseChatGptConversation(capture);
    expect(Object.keys(conversation.nodes).sort()).toEqual(Object.keys(parseChatGptConversation(fixture).conversation.nodes).sort());
    expect(conversation.nodes[conversation.rootId]!.notFetched).toBeUndefined(); // the walk reached the first page
  });

  it('lists chats across the app\'s list variants, and Projects with every page of their chats', async () => {
    const { client } = await harness();
    expect((await client.listChats()).map((c) => c.id).sort()).toEqual([IMAGE_CHAT_ID, PLAIN_CHAT_ID].sort());
    const projects = await client.listProjects();
    expect(projects.map((p) => [p.id, p.name, p.chats.map((c) => c.id)])).toEqual([[PROJECT_ID, 'Anonymized Project', [PROJECT_CHAT_ID]]]);
  });

  it('downloads a file through files/download and the signed URL', async () => {
    const { client } = await harness();
    expect(await client.downloadFile('file-cat')).toEqual({ ok: true, bytes: IMAGE_BYTES, fileName: 'cat.jpg', mime: 'image/jpeg' });
  });

  it('a 404 is a non-retried HttpError', async () => {
    const { client } = await harness();
    await expect(client.fetchConversation('missing')).rejects.toBeInstanceOf(HttpError);
  });

  it('says what to do when the app has not loaded a chat yet', async () => {
    const { client } = await harness({ appRequests: ['chatListB'] });
    await expect(client.fetchConversation(PLAIN_CHAT_ID)).rejects.toThrow(/Open any chat/);
  });

  it('reconnects after the ChatGPT tab reloads', async () => {
    const h = await harness();
    await h.client.listChats();
    h.ports[0]!.disconnect(); // the content script went away with the old page
    await new Promise((r) => setTimeout(r, 10));
    expect((await h.client.listChats()).length).toBe(2);
    expect(h.ports).toHaveLength(2);
    // A request already in flight when the tab goes away fails as a network error, which the scheduler retries.
    const p = h.link.call({ op: 'state' });
    h.ports[1]!.disconnect();
    await expect(p).rejects.toThrow(/closed or reloaded/);
  });
});

