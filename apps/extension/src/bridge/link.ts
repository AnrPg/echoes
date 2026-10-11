// Extension-page side of the bridge: a request/reply link over a runtime port to the content script of a
// chatgpt.com tab, and the core Transport built on it.

import type { Transport } from '@echoes/core';
import type { BridgeResponse } from '../chatgpt/client';
import type { PortRequest } from './messages';
import { BridgeReplyZ, LearnedStateZ } from './messages';
import { classifyPath, type BridgeReply, type LearnedState } from './protocol';

/** The part of `chrome.runtime.Port` the link uses. */
export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  disconnect(): void;
}

export class BridgeClosedError extends Error {
  override readonly name = 'BridgeClosedError';
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = { resolve(r: BridgeReply): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> };

/**
 * Sends requests to the page and matches replies by id. Reconnects through `connect` when the port closed (the tab
 * reloaded or navigated), so a long export survives a page reload.
 */
export class BridgeLink {
  readonly #connect: () => PortLike;
  readonly #timeoutMs: number;
  #port: PortLike | undefined;
  readonly #pending = new Map<string, Pending>();
  #seq = 0;
  #retarget = false;

  constructor(connect: () => PortLike, timeoutMs = 120_000) {
    this.#connect = connect;
    this.#timeoutMs = timeoutMs;
  }

  #portOrConnect(): PortLike {
    if (this.#port) return this.#port;
    const port = this.#connect();
    port.onMessage.addListener((m) => {
      const r = BridgeReplyZ.safeParse(m);
      if (!r.success || !('id' in r.data)) return;
      const p = this.#pending.get(r.data.id);
      if (!p) return;
      this.#pending.delete(r.data.id);
      clearTimeout(p.timer);
      p.resolve(r.data);
      if (this.#retarget && this.#pending.size === 0) this.close();
    });
    port.onDisconnect.addListener(() => {
      if (this.#port === port) this.#port = undefined;
      for (const [id, p] of this.#pending) {
        clearTimeout(p.timer);
        p.reject(new BridgeClosedError('the ChatGPT tab was closed or reloaded'));
        this.#pending.delete(id);
      }
    });
    this.#port = port;
    return port;
  }

  call(request: WithoutId<PortRequest>): Promise<BridgeReply> {
    if (this.#retarget && this.#pending.size === 0) this.close();
    const id = `r${++this.#seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BridgeClosedError('the ChatGPT tab did not answer'));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      // A port can be dead without a disconnect event having arrived yet: retry once on a fresh one.
      for (let attempt = 0; ; attempt++) {
        try {
          this.#portOrConnect().postMessage({ ...request, id });
          return;
        } catch (e) {
          this.#port = undefined;
          if (attempt === 0) continue;
          clearTimeout(timer);
          this.#pending.delete(id);
          reject(new BridgeClosedError(`could not reach the ChatGPT tab: ${e instanceof Error ? e.message : String(e)}`));
          return;
        }
      }
    });
  }

  async learned(): Promise<LearnedState> {
    const r = await this.call({ op: 'state' });
    if (r.op === 'state') return LearnedStateZ.parse(r.state);
    throw new Error(r.op === 'error' ? r.message : 'unexpected reply');
  }

  close(): void {
    this.#retarget = false;
    this.#port?.disconnect();
    this.#port = undefined;
  }

  /**
   * Connect afresh (the connect function now names another tab) once the calls in flight have their answers, so
   * none is cut off.
   */
  reconnect(): void {
    if (this.#pending.size === 0) this.close();
    else this.#retarget = true;
  }
}

const headersOf = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

/**
 * A core `Transport` over the bridge. Bridge errors map onto what the scheduler already handles: "no session yet"
 * becomes a 401 (the queue pauses and the user is asked to reload or log in), a refused URL a 400 (not retried),
 * and a closed tab a network error (retried with backoff).
 */
export function bridgeTransport(link: BridgeLink): Transport<BridgeResponse> {
  return async (req) => {
    if (req.method !== 'GET') return { status: 405, headers: headersOf({}), body: '' };
    const binary = classifyPath(new URL(req.url).pathname)?.kind === 'fileContent';
    const r = await link.call(binary ? { op: 'fetch', url: req.url, binary } : { op: 'fetch', url: req.url });
    if (r.op === 'fetch') return { status: r.status, headers: headersOf(r.headers), body: r.body };
    if (r.op === 'error' && r.message.startsWith('no-session')) return { status: 401, headers: headersOf({}), body: r.message };
    if (r.op === 'error' && r.message.startsWith('refused')) return { status: 400, headers: headersOf({}), body: r.message };
    throw new Error(r.op === 'error' ? r.message : 'unexpected reply from the ChatGPT tab');
  };
}
