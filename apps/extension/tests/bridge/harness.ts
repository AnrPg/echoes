// In-process wiring of the whole bridge for tests: fake page window (main world + content script share it, as in
// the browser), fake runtime ports, and the fake ChatGPT backend behind window.fetch.

import { Scheduler, type Clock } from '@echoes/core';
import { BridgeLink, bridgeTransport, type PortLike } from '../../src/bridge/link';
import { installBridge } from '../../src/bridge/page';
import { BRIDGE_PORT } from '../../src/bridge/protocol';
import { ChatGptClient, type BridgeResponse } from '../../src/chatgpt/client';
import { installRelay } from '../../src/content/relay';
import { APP_QUERIES, ORIGIN, TOKEN, respond } from '../fake-chatgpt';

export class FakeWindow {
  private listeners: ((ev: MessageEvent) => void)[] = [];
  readonly posted: unknown[] = [];
  fetch: typeof fetch = async (input, init) => {
    const req = new Request(new URL(String(input instanceof Request ? input.url : input), ORIGIN), init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const r = respond(req.url, headers);
    return new Response(r.body as BodyInit, { status: r.status, headers: { 'content-type': r.contentType } });
  };
  addEventListener(_type: 'message', fn: (ev: MessageEvent) => void) {
    this.listeners.push(fn);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
    const ev = { data: structuredClone(data), source: this } as unknown as MessageEvent;
    queueMicrotask(() => this.listeners.forEach((l) => l(ev)));
  }
}

/** A connected pair of fake runtime ports. Messages are JSON-copied, like extension messaging. */
export function portPair(name: string): [PortLike & { name: string }, PortLike & { name: string }] {
  const make = () => {
    const onMsg: ((m: unknown) => void)[] = [];
    const onDisc: (() => void)[] = [];
    return { name, onMsg, onDisc, other: undefined as any, closed: false };
  };
  const a = make();
  const b = make();
  a.other = b;
  b.other = a;
  const api = (s: typeof a) => ({
    name,
    postMessage(m: unknown) {
      if (s.closed) throw new Error('Attempting to use a disconnected port object');
      const copy = JSON.parse(JSON.stringify(m));
      queueMicrotask(() => s.other.onMsg.forEach((f: (m: unknown) => void) => f(copy)));
    },
    onMessage: { addListener: (f: (m: unknown) => void) => s.onMsg.push(f) },
    onDisconnect: { addListener: (f: () => void) => s.onDisc.push(f) },
    disconnect() {
      s.closed = s.other.closed = true;
      queueMicrotask(() => s.other.onDisc.forEach((f: () => void) => f()));
    },
  });
  return [api(a), api(b)];
}

export const instantClock: Clock = { now: () => 0, sleep: () => Promise.resolve() };

/** A page where the app has already made its usual requests, a relay, and a client in an "extension page". */
export async function harness(opts: { appRequests?: (keyof typeof APP_QUERIES)[]; authenticated?: boolean } = {}) {
  const win = new FakeWindow();
  const bridge = installBridge(win, { origin: ORIGIN, now: () => 1 });
  const branchMessages: unknown[] = [];
  const connectListeners: ((p: PortLike & { name: string }) => void)[] = [];
  installRelay(win, { onConnect: { addListener: (f) => connectListeners.push(f) }, sendMessage: (m) => void branchMessages.push(m) }, ORIGIN);
  const headers = opts.authenticated === false ? { 'oai-language': 'en-US' } : { Authorization: TOKEN, 'oai-language': 'en-US', 'content-type': 'application/json' };
  for (const k of opts.appRequests ?? (Object.keys(APP_QUERIES) as (keyof typeof APP_QUERIES)[])) {
    await (await win.fetch(APP_QUERIES[k], { headers })).text();
  }
  /** The content-script ends, as a reload would drop them. */
  const ports: (PortLike & { name: string })[] = [];
  const link = new BridgeLink(() => {
    const [mine, theirs] = portPair(BRIDGE_PORT);
    ports.push(theirs);
    connectListeners.forEach((f) => f(theirs));
    return mine;
  }, 2000);
  const scheduler = new Scheduler<BridgeResponse>({ transport: bridgeTransport(link), clock: instantClock, intervalMs: 0, jitterMs: 0, maxRetries: 1 });
  const client = new ChatGptClient({ origin: ORIGIN, scheduler, learned: () => link.learned() });
  return { win, bridge, link, scheduler, client, branchMessages, ports };
}
