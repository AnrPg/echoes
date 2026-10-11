// The page bridge: how extension pages get ChatGPT data through the user's logged-in chatgpt.com tab.
//
//   extension page ──port──▶ content script ──window.postMessage──▶ main-world bridge ──fetch──▶ chatgpt.com
//
// The main-world bridge observes the web app's own requests (never changing them) and keeps, in page memory only,
// the request headers the app last sent and the query strings it used per endpoint. It then runs Echoes' GET
// requests with those same headers. The session token never leaves the page: it is not posted to the content
// script, the extension, or storage.
//
// Kept dependency-free (no zod): the main-world script imports it and must stay small. The isolated side validates
// with zod in bridge/messages.ts.

export const BRIDGE_CHANNEL = 'echoes-v1-bridge';
export const BRIDGE_PORT = 'echoes-bridge';

/** The ChatGPT endpoints Echoes reads, as observed in Phase 0 (docs/phase-0.md). Nothing else is ever requested. */
export type EndpointKind =
  | 'chatList'
  | 'conversation'
  | 'messages'
  | 'versions'
  | 'projectSidebar'
  | 'projectChats'
  | 'fileDownload'
  | 'fileContent';

export interface Endpoint {
  kind: EndpointKind;
  /** The id in the path (conversation, Project or file), when the endpoint has one. */
  id?: string;
}

const ID = '([A-Za-z0-9_-]+)';
const ROUTES: [RegExp, EndpointKind][] = [
  [/^\/backend-api\/conversations$/, 'chatList'],
  [new RegExp(`^/backend-api/conversations/${ID}$`), 'conversation'],
  [new RegExp(`^/backend-api/conversations/${ID}/messages$`), 'messages'],
  [new RegExp(`^/backend-api/conversations/${ID}/versions$`), 'versions'],
  [/^\/backend-api\/gizmos\/snorlax\/sidebar$/, 'projectSidebar'],
  [new RegExp(`^/backend-api/gizmos/${ID}/conversations$`), 'projectChats'],
  [new RegExp(`^/backend-api/files/download/${ID}$`), 'fileDownload'],
  [/^\/backend-api\/estuary\/content$/, 'fileContent'],
];

/** Which Echoes endpoint a path is, or undefined for anything else. */
export function classifyPath(path: string): Endpoint | undefined {
  for (const [re, kind] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    // `gizmos/snorlax/sidebar` also matches nothing else; `conversations/:id` must not swallow the list.
    return m[1] === undefined ? { kind } : { kind, id: m[1] };
  }
  return undefined;
}

/** Query parameters in the order the web app sent them. Values matter: Phase 0 recorded names only. */
export type QueryTemplate = [name: string, value: string][];

/** What the bridge learned from the web app's own traffic. Contains no header values. */
export interface LearnedState {
  /** True once a request with an `authorization` header was seen, so Echoes requests can be authenticated. */
  authSeen: boolean;
  /** Latest query per endpoint kind. `chatList` keeps each distinct variant (the app lists chats in two calls). */
  templates: Partial<Record<Exclude<EndpointKind, 'chatList'>, QueryTemplate>>;
  chatListVariants: QueryTemplate[];
}

export function emptyLearnedState(): LearnedState {
  return { authSeen: false, templates: {}, chatListVariants: [] };
}

/** Parameters Echoes sets itself per request; everything else is copied from the app's template. */
export const PAGING_PARAMS: Partial<Record<EndpointKind, readonly string[]>> = {
  chatList: ['offset'],
  messages: ['before'],
  versions: ['message_id'],
  projectSidebar: ['cursor'],
  projectChats: ['cursor'],
};

/** Record one observed app request. Returns true when something new was learned. */
export function learn(state: LearnedState, url: URL, hasAuth: boolean): boolean {
  const ep = classifyPath(url.pathname);
  let changed = false;
  if (hasAuth && !state.authSeen) {
    state.authSeen = true;
    changed = true;
  }
  if (!ep || ep.kind === 'fileContent' || ep.kind === 'fileDownload') return changed;
  const query: QueryTemplate = [...url.searchParams.entries()];
  if (ep.kind === 'chatList') {
    const key = variantKey(query);
    const i = state.chatListVariants.findIndex((v) => variantKey(v) === key);
    if (i === -1) {
      if (state.chatListVariants.length < 4) state.chatListVariants.push(query);
    } else state.chatListVariants[i] = query;
    return true;
  }
  state.templates[ep.kind] = query;
  return true;
}

/** Chat list variants differ by which parameters they send (e.g. `conversation_origin` vs `exclude_conversation_origin`). */
function variantKey(q: QueryTemplate): string {
  return q
    .map(([k]) => k)
    .filter((k) => k !== 'offset')
    .sort()
    .join('&');
}

/** A request from the extension to the main-world bridge. */
export type BridgeRequest =
  | { channel: typeof BRIDGE_CHANNEL; dir: 'to-page'; id: string; op: 'fetch'; url: string; binary?: boolean }
  | { channel: typeof BRIDGE_CHANNEL; dir: 'to-page'; id: string; op: 'state' };

/** A reply or an event from the main-world bridge. */
export type BridgeReply =
  | {
      channel: typeof BRIDGE_CHANNEL;
      dir: 'from-page';
      id: string;
      op: 'fetch';
      status: number;
      /** Only the headers the scheduler reads. */
      headers: Record<string, string>;
      /** Text, or base64 when `binary` was asked. */
      body: string;
    }
  | { channel: typeof BRIDGE_CHANNEL; dir: 'from-page'; id: string; op: 'state'; state: LearnedState }
  | { channel: typeof BRIDGE_CHANNEL; dir: 'from-page'; id: string; op: 'error'; message: string }
  | { channel: typeof BRIDGE_CHANNEL; dir: 'from-page'; op: 'branch'; t: number; request: unknown; response: unknown };

/** Response headers passed back to the scheduler (rate limits and bot checks). */
export const FORWARDED_HEADERS = ['retry-after', 'content-type', 'cf-mitigated'] as const;

/** Why the bridge refuses a URL, or undefined when Echoes may request it. Only GETs to the listed endpoints. */
export function refuseUrl(url: string, origin: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'not a URL';
  }
  if (u.origin !== origin) return `other origin ${u.origin}`;
  if (!classifyPath(u.pathname)) return `not an Echoes endpoint: ${u.pathname}`;
  return undefined;
}
