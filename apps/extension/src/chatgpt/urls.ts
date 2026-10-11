// Build request URLs for the ChatGPT endpoints from what the page bridge learned. Pure, so it is unit-tested.
//
// Phase 0 recorded parameter NAMES, not values, so Echoes never invents values: it copies the query the web app
// itself used (learned at runtime) and only sets its own paging parameter. Where the app's request for an endpoint
// has not been seen yet, the fallbacks below are marked inferred; the self-test reports which ones were used.

import { PAGING_PARAMS, type EndpointKind, type LearnedState, type QueryTemplate } from '../bridge/protocol';

export class MissingTemplateError extends Error {
  override readonly name = 'MissingTemplateError';
}

export type TemplateSource = 'learned' | 'inferred';

export interface BuiltUrl {
  url: string;
  source: TemplateSource;
}

const PATHS: Record<Exclude<EndpointKind, 'fileContent'>, (id: string) => string> = {
  chatList: () => '/backend-api/conversations',
  conversation: (id) => `/backend-api/conversations/${enc(id)}`,
  messages: (id) => `/backend-api/conversations/${enc(id)}/messages`,
  versions: (id) => `/backend-api/conversations/${enc(id)}/versions`,
  projectSidebar: () => '/backend-api/gizmos/snorlax/sidebar',
  projectChats: (id) => `/backend-api/gizmos/${enc(id)}/conversations`,
  fileDownload: (id) => `/backend-api/files/download/${enc(id)}`,
};

const enc = encodeURIComponent;

const HOW_TO_LEARN: Partial<Record<EndpointKind, string>> = {
  conversation: 'Open any chat in the ChatGPT tab once, so Echoes can see how ChatGPT loads a chat.',
  chatList: 'Reload the ChatGPT tab with the sidebar open, so Echoes can see how ChatGPT lists chats.',
  projectSidebar: 'Reload the ChatGPT tab with the sidebar open, so Echoes can see how ChatGPT lists Projects.',
  projectChats: 'Open a Project in the ChatGPT tab once, so Echoes can see how ChatGPT lists its chats.',
};

function withParams(template: QueryTemplate, kind: EndpointKind, set: Record<string, string>): string {
  const own = new Set(PAGING_PARAMS[kind] ?? []);
  const params = new URLSearchParams();
  for (const [k, v] of template) if (!own.has(k) && !(k in set)) params.append(k, v);
  for (const [k, v] of Object.entries(set)) params.set(k, v);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * The URL for one request. `set` holds Echoes' own parameters (paging cursor, message id). Throws
 * {@link MissingTemplateError} with a user-facing hint when the endpoint needs a template that was never learned.
 */
export function buildUrl(
  origin: string,
  learned: LearnedState,
  kind: Exclude<EndpointKind, 'fileContent' | 'chatList'>,
  id: string,
  set: Record<string, string> = {},
): BuiltUrl {
  const path = origin + PATHS[kind](id);
  const own = learned.templates[kind];
  if (own) return { url: path + withParams(own, kind, set), source: 'learned' };
  switch (kind) {
    case 'messages': {
      // Inferred: the older-page request takes the same parameters as the first page plus `before` (Phase 0 saw
      // `messages?before&include_has_versions&num_turns`).
      const head = learned.templates.conversation;
      if (!head) throw new MissingTemplateError(HOW_TO_LEARN.conversation);
      return { url: path + withParams(head, kind, set), source: 'inferred' };
    }
    case 'versions':
    case 'fileDownload':
      // Phase 0 saw `versions?message_id` and `files/download/:id` with no other parameters.
      return { url: path + withParams([], kind, set), source: 'inferred' };
    default:
      throw new MissingTemplateError(HOW_TO_LEARN[kind] ?? `ChatGPT's ${kind} request has not been seen yet.`);
  }
}

/** One URL per learned chat-list variant (the app lists chats in more than one call), at this offset. */
export function chatListUrls(origin: string, learned: LearnedState, offset: number): string[] {
  if (learned.chatListVariants.length === 0) throw new MissingTemplateError(HOW_TO_LEARN.chatList);
  return learned.chatListVariants.map((v) => origin + PATHS.chatList('') + withParams(v, 'chatList', { offset: String(offset) }));
}
