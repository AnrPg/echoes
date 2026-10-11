// A fake chatgpt.com backend for tests: unit tests call `respond` directly, and the browser smoke test serves it
// through Playwright request interception, so no request ever reaches OpenAI.
//
// Data: the adapter's anonymized Project chat fixture (paged, with a regenerated answer), plus a small chat with an
// image so attachment download is exercised. Shapes follow the Phase 0 capture reports.

import { readFileSync } from 'node:fs';

export const TOKEN = 'Bearer test-token';
export const ORIGIN = 'https://chatgpt.com';

const fixture = JSON.parse(
  readFileSync(new URL('../../../packages/adapter-chatgpt-api/fixtures/project-chat-regenerated.json', import.meta.url), 'utf8'),
) as { conversation: any; olderPages: any[]; versions: Record<string, unknown> };

export const PROJECT_CHAT_ID: string = fixture.conversation.conversation_id;
export const PROJECT_ID: string = fixture.conversation.gizmo_id;
export const IMAGE_CHAT_ID = '00000000-0000-4000-8000-00000000abcd';
export const PLAIN_CHAT_ID = '00000000-0000-4000-8000-00000000beef';
export const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

// The fixture's oldest page still says it has older pages; the fake ends the walk there.
const olderPages = structuredClone(fixture.olderPages);
olderPages.at(-1).page_info.has_previous_page = false;

function simpleChat(id: string, title: string, parts: unknown[], updated: number) {
  const msg = (mid: string, role: string, content: unknown, t: number) => ({
    id: mid,
    author: { role },
    create_time: t,
    content,
    recipient: 'all',
    weight: 1,
    metadata: {},
  });
  const q = `${id.slice(0, -4)}0001`;
  const a = `${id.slice(0, -4)}0002`;
  return {
    conversation_id: id,
    title,
    create_time: updated - 60,
    update_time: updated,
    current_node: a,
    default_model_slug: 'gpt-test',
    gizmo_id: null,
    gizmo_type: null,
    is_archived: false,
    page_info: { start_cursor: q, end_cursor: a, has_previous_page: false, has_next_page: false },
    messages: [
      msg(q, 'user', { content_type: 'text', parts: ['Draw a cat'] }, updated - 50),
      msg(a, 'assistant', { content_type: 'multimodal_text', parts }, updated - 40),
    ],
  };
}

const imageChat = simpleChat(IMAGE_CHAT_ID, 'Cat picture', [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-cat' }, 'Here is a cat.'], 1791000000);
const plainChat = simpleChat(PLAIN_CHAT_ID, 'Plain chat', ['Just text, $5 and \\(x^2\\).'], 1791000500);

const listItem = (c: { conversation_id: string; title: string; create_time: number; update_time: number; gizmo_id?: string | null }) => ({
  id: c.conversation_id,
  title: c.title,
  create_time: new Date(c.create_time * 1000).toISOString(),
  update_time: new Date(c.update_time * 1000).toISOString(),
  current_node: null,
  mapping: null,
  gizmo_id: c.gizmo_id ?? null,
  is_archived: false,
});

/** Mutable, so a test can change a chat between runs. */
export const state = {
  /** Requests seen, as path + query. */
  log: [] as string[],
  chats: { [IMAGE_CHAT_ID]: imageChat, [PLAIN_CHAT_ID]: plainChat } as Record<string, ReturnType<typeof simpleChat>>,
};

export interface FakeResponse {
  status: number;
  contentType: string;
  body: string | Uint8Array;
}

const json = (v: unknown, status = 200): FakeResponse => ({ status, contentType: 'application/json', body: JSON.stringify(v) });

/** Answer one request the way the fake backend does. Requests without the test token get a 401. */
export function respond(url: string, headers: Record<string, string>, method = 'GET'): FakeResponse {
  const u = new URL(url, ORIGIN);
  state.log.push(u.pathname + u.search);
  if (method === 'POST' && u.pathname === '/backend-api/conversation/new_branch') {
    // "Branch in new chat" made the image chat from the plain chat (response shape from Phase 0).
    return json({ conversation: { conversation_id: IMAGE_CHAT_ID, current_node: imageChat.current_node, create_time: imageChat.create_time, mapping: {} } });
  }
  if (method !== 'GET') return json({ detail: 'not in the fake' }, 405);
  if (!u.pathname.startsWith('/backend-api/')) return { status: 404, contentType: 'text/plain', body: '' };
  if ((headers['authorization'] ?? headers['Authorization']) !== TOKEN) return json({ detail: 'Unauthorized' }, 401);
  const q = u.searchParams;
  const p = u.pathname.slice('/backend-api'.length);
  let m: RegExpExecArray | null;

  if (p === '/conversations') {
    // Two variants, like the web app: `conversation_origin=…` lists none here; the other lists the plain chats.
    if (q.has('conversation_origin')) return json({ items: [], total: 0, limit: 20, offset: 0 });
    const all = Object.values(state.chats).map(listItem);
    const limit = Number(q.get('limit') ?? 20);
    const offset = Number(q.get('offset') ?? 0);
    return json({ items: all.slice(offset, offset + limit), total: all.length, limit, offset });
  }
  if ((m = /^\/conversations\/([^/]+)$/.exec(p))) {
    if (m[1] === PROJECT_CHAT_ID) return json(fixture.conversation);
    const c = state.chats[m[1]!];
    return c ? json(c) : json({ detail: 'not found' }, 404);
  }
  if ((m = /^\/conversations\/([^/]+)\/messages$/.exec(p)) && m[1] === PROJECT_CHAT_ID) {
    const before = q.get('before');
    if (before === fixture.conversation.page_info.start_cursor) return json(olderPages[0]);
    if (before === olderPages[0].page_info.start_cursor) return json(olderPages[1]);
    return json({ detail: `unknown cursor ${before}` }, 400);
  }
  if ((m = /^\/conversations\/([^/]+)\/versions$/.exec(p)) && m[1] === PROJECT_CHAT_ID) {
    const v = fixture.versions[q.get('message_id') ?? ''];
    return v ? json(v) : json({ detail: 'no versions' }, 404);
  }
  if (p === '/gizmos/snorlax/sidebar') {
    return json({
      cursor: null,
      items: [
        {
          gizmo: { gizmo: { id: PROJECT_ID, gizmo_type: 'snorlax', display: { name: 'Anonymized Project' } } },
          conversations: { cursor: 'page-2', items: [] },
        },
      ],
    });
  }
  if ((m = /^\/gizmos\/([^/]+)\/conversations$/.exec(p)) && m[1] === PROJECT_ID) {
    if (q.get('cursor') === 'page-2') return json({ cursor: null, items: [listItem({ ...fixture.conversation, gizmo_id: PROJECT_ID })] });
    return json({ cursor: null, items: [] });
  }
  if (p === '/files/download/file-cat') {
    return json({ status: 'success', download_url: `${ORIGIN}/backend-api/estuary/content?id=file-cat&sig=s&ts=1`, file_name: 'cat.jpg', file_size_bytes: IMAGE_BYTES.length, mime_type: null });
  }
  if (p === '/estuary/content' && q.get('id') === 'file-cat') return { status: 200, contentType: 'image/jpeg', body: IMAGE_BYTES };
  return json({ detail: 'not found' }, 404);
}

/** The query strings the web app uses, as a page bridge would learn them (values made up for the fake). */
export const APP_QUERIES = {
  chatListA: '/backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false&conversation_origin=tpp',
  chatListB: '/backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false&exclude_conversation_origin=tpp',
  conversation: `/backend-api/conversations/${PLAIN_CHAT_ID}?include_has_versions=true&num_turns=12`,
  sidebar: '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=5&owned_only=true',
  projectChats: `/backend-api/gizmos/${PROJECT_ID}/conversations?limit=20&owned_only=true`,
};
