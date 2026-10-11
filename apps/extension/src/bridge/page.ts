// Main-world side of the page bridge (see protocol.ts). It wraps window.fetch only to OBSERVE the app's requests:
// the page always gets the original promise from the original fetch, with the same arguments and receiver.

import {
  BRIDGE_CHANNEL,
  FORWARDED_HEADERS,
  emptyLearnedState,
  learn,
  refuseUrl,
  type BridgeReply,
  type LearnedState,
} from './protocol';
import { toBase64 } from './base64';

export interface BridgeTarget {
  fetch: typeof fetch;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BridgeOptions {
  origin: string;
  now?: () => number;
}

/** Headers never replayed: they describe a body, and Echoes sends GETs without one. */
const SKIP_HEADERS = new Set(['content-type', 'content-length']);
const NEW_BRANCH = '/backend-api/conversation/new_branch';

export interface InstalledBridge {
  /** For tests. */
  state(): LearnedState;
  uninstall(): void;
}

export function installBridge(target: BridgeTarget, opts: BridgeOptions): InstalledBridge {
  const now = opts.now ?? (() => Date.now());
  const origFetch = target.fetch;
  const learned = emptyLearnedState();
  // The headers of the app's latest authenticated GET to /backend-api/, in page memory only.
  let replayHeaders: Headers | undefined;

  const post = (reply: BridgeReply) => {
    try {
      target.postMessage(reply, opts.origin);
    } catch {
      /* never break the page */
    }
  };

  const wrapped = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    let branchBody: Promise<string | null> | undefined;
    try {
      const [input, init] = args;
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = new URL(isReq ? input.url : input instanceof URL ? input.href : String(input), opts.origin);
      const method = (init?.method ?? (isReq ? input.method : 'GET')).toUpperCase();
      if (url.origin === opts.origin && url.pathname.startsWith('/backend-api/')) {
        const headers = new Headers(isReq ? input.headers : undefined);
        if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
        const hasAuth = headers.has('authorization');
        if (method === 'GET') {
          learn(learned, url, hasAuth);
          if (hasAuth) {
            const keep = new Headers();
            headers.forEach((v, k) => {
              if (!SKIP_HEADERS.has(k)) keep.set(k, v);
            });
            replayHeaders = keep;
          }
        } else if (method === 'POST' && url.pathname === NEW_BRANCH) {
          // Read the body before the original fetch consumes it.
          if (typeof init?.body === 'string') branchBody = Promise.resolve(init.body);
          else if (isReq) branchBody = input.clone().text().catch(() => null);
        }
      }
    } catch {
      /* observation must never affect the page */
    }
    const p = Reflect.apply(origFetch, this, args) as Promise<Response>;
    if (branchBody) {
      const bodyP = branchBody;
      p.then((res) => {
        if (!res.ok) return;
        const clone = res.clone(); // synchronously, before the page reads the body
        void Promise.all([bodyP, clone.json()])
          .then(([body, response]) => {
            if (body !== null) post({ channel: BRIDGE_CHANNEL, dir: 'from-page', op: 'branch', t: now(), request: JSON.parse(body), response });
          })
          .catch(() => undefined);
      }).catch(() => undefined);
    }
    return p;
  };
  target.fetch = wrapped as typeof fetch;

  const onMessage = (ev: MessageEvent) => {
    const m = ev.data as { channel?: unknown; dir?: unknown; id?: unknown; op?: unknown; url?: unknown; binary?: unknown };
    if (ev.source !== (target as unknown) || m?.channel !== BRIDGE_CHANNEL || m.dir !== 'to-page' || typeof m.id !== 'string') return;
    const id = m.id;
    if (m.op === 'state') {
      post({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'state', state: structuredClone(learned) });
      return;
    }
    if (m.op !== 'fetch' || typeof m.url !== 'string') return;
    const refused = refuseUrl(m.url, opts.origin);
    if (refused) return post({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'error', message: `refused: ${refused}` });
    if (!replayHeaders) {
      return post({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'error', message: 'no-session: the page has not made an authenticated request yet' });
    }
    void run(id, m.url, m.binary === true, replayHeaders);
  };

  async function run(id: string, url: string, binary: boolean, headers: Headers) {
    try {
      const res = await Reflect.apply(origFetch, globalThis, [url, { method: 'GET', headers, credentials: 'include' }]) as Response;
      const forwarded: Record<string, string> = {};
      for (const h of FORWARDED_HEADERS) {
        const v = res.headers.get(h);
        if (v !== null) forwarded[h] = v;
      }
      const body = binary ? toBase64(new Uint8Array(await res.arrayBuffer())) : await res.text();
      post({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'fetch', status: res.status, headers: forwarded, body });
    } catch (e) {
      post({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'error', message: `network: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  target.addEventListener('message', onMessage);
  return {
    state: () => structuredClone(learned),
    uninstall: () => {
      target.fetch = origFetch;
    },
  };
}
