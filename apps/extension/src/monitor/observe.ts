// Passive observers for the main world. They NEVER change a request or a response:
// the page always receives the original promise from the original fetch.
// Pitfalls handled:
// - `this` is forwarded unchanged (native fetch throws "Illegal invocation" on a wrong receiver).
// - The request body is cloned BEFORE the original fetch consumes it.
// - Response bodies are read from res.clone(), taken synchronously in the first callback (before the page
//   can consume the body), and only for JSON/SSE (an unread clone buffers the whole body).
// - Our own failures are swallowed; a page-visible rejection is exactly the original one.

import type { CaptureRecord, FetchRecord } from '../inspect/messages';
import { parseSse, parseSseData } from '../inspect/sse';
import { mergeShapes, shapeOf, type Shape } from '../inspect/shape';
import { templateUrl, type UrlTemplate } from '../inspect/url';

export interface ObserveOptions {
  /** Page origin used to resolve relative URLs. */
  base: string;
  now?: () => number;
  /** Max body bytes to read for shape capture. */
  maxBodyBytes?: number;
  /** Max raw JSON body size forwarded for optional raw capture. */
  maxRawBytes?: number;
}

export interface ObserveTarget {
  fetch: typeof fetch;
  WebSocket?: typeof WebSocket;
}

type Emit = (r: CaptureRecord) => void;

const STATIC_ASSET = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|wasm)$/i;
const MAX_SSE_EVENTS = 5000;

export function installObservers(target: ObserveTarget, emit: Emit, opts: ObserveOptions): () => void {
  const now = opts.now ?? (() => Date.now());
  const maxBody = opts.maxBodyBytes ?? 20 * 1024 * 1024;
  const maxRaw = opts.maxRawBytes ?? 5 * 1024 * 1024;
  const origFetch = target.fetch;

  const wrapped = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    let pre: Promise<Partial<FetchRecord> | null> | null = null;
    const t = now();
    try {
      pre = describeRequest(args[0], args[1], opts.base);
    } catch {
      pre = null;
    }
    const p = Reflect.apply(origFetch, this, args) as Promise<Response>;
    if (pre) {
      const reqP = pre;
      p.then(
        (res) => observeResponse(res, reqP, t),
        (err: unknown) => finish(reqP, t, { error: err instanceof Error ? err.name : 'unknown error' }),
      ).catch(() => undefined);
    }
    return p;
  };

  async function observeResponse(res: Response, reqP: Promise<Partial<FetchRecord> | null>, t: number) {
    const extra: Partial<FetchRecord> = { status: res.status };
    const ct = res.headers.get('content-type') ?? undefined;
    if (ct !== undefined) extra.resContentType = ct.split(';')[0]!.trim();
    const len = Number(res.headers.get('content-length') ?? '0');
    const isSse = ct?.includes('text/event-stream') ?? false;
    const isJson = ct?.includes('json') ?? false;
    // Clone synchronously, BEFORE any await: once the page reads the body, clone() throws "body used".
    let clone: Response | null = null;
    try {
      if (len <= maxBody && (isSse || isJson) && !res.bodyUsed) clone = res.clone();
    } catch {
      clone = null;
    }
    const req = await reqP;
    try {
      if (clone && isSse) {
        extra.sse = summarizeSse(await clone.text());
      } else if (clone && isJson) {
        const text = await clone.text();
        const json: unknown = JSON.parse(text);
        extra.resBody = shapeOf(json);
        // ASSUMPTION (unverified until Phase 0 data): ChatGPT's JSON API lives under /backend-api/.
        // If wrong, raw capture simply stays empty; shape capture is unaffected.
        if (req?.method === 'GET' && req.url?.path.startsWith('/backend-api/') && text.length <= maxRaw) {
          extra.raw = json;
        }
      }
    } catch (e) {
      extra.error = `body read failed: ${e instanceof Error ? e.name : 'unknown'}`;
    }
    await finish(reqP, t, extra);
  }

  async function finish(reqP: Promise<Partial<FetchRecord> | null>, t: number, extra: Partial<FetchRecord>) {
    const req = await reqP.catch(() => null);
    if (!req || !req.url || !req.method) return;
    const rec: FetchRecord = {
      v: 1, kind: 'fetch', t, method: req.method, url: req.url,
      reqHeaders: req.reqHeaders ?? [], ms: now() - t,
      ...pick(req, ['reqContentType', 'reqBody']),
      ...extra,
    };
    try { emit(rec); } catch { /* never break the page */ }
  }

  target.fetch = wrapped as typeof fetch;

  const OrigWS = target.WebSocket;
  if (OrigWS) {
    // A subclass keeps instanceof checks and static constants (OPEN, CLOSED…) intact.
    target.WebSocket = class extends OrigWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        try {
          const u = templateUrl(String(url), opts.base);
          if (u) emit({ v: 1, kind: 'websocket', t: now(), url: u });
        } catch { /* ignore */ }
      }
    };
  }

  return () => {
    target.fetch = origFetch;
    if (OrigWS) target.WebSocket = OrigWS;
  };
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** Synchronous part (URL, method, headers, body clone) must run before the original fetch. */
function describeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  base: string,
): Promise<Partial<FetchRecord> | null> | null {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const href = isReq ? input.url : input instanceof URL ? input.href : String(input);
  const url: UrlTemplate | null = templateUrl(href, base);
  if (!url || STATIC_ASSET.test(url.path)) return null;
  const method = (init?.method ?? (isReq ? input.method : 'GET')).toUpperCase();

  const headers = new Headers(isReq ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  const reqHeaders: string[] = [];
  headers.forEach((_v, k) => reqHeaders.push(k)); // names only; values (auth tokens) never leave this function
  reqHeaders.sort();
  const reqContentType = headers.get('content-type')?.split(';')[0]?.trim();

  let bodyText: Promise<string | null> = Promise.resolve(null);
  let bodyNote: string | undefined;
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') bodyText = Promise.resolve(init.body);
    else bodyNote = bodyKind(init.body);
  } else if (isReq && method !== 'GET' && method !== 'HEAD' && input.body) {
    const clone = input.clone();
    bodyText = clone.text().catch(() => null);
  }

  return bodyText.then((text) => {
    const r: Partial<FetchRecord> = { url, method, reqHeaders };
    if (reqContentType) r.reqContentType = reqContentType;
    if (text !== null) {
      try { r.reqBody = shapeOf(JSON.parse(text)); } catch { r.reqBody = shapeOf(`<non-json ${text.length} chars>`); }
    } else if (bodyNote) {
      r.reqBody = shapeOf(bodyNote);
    }
    return r;
  });
}

function bodyKind(b: BodyInit): string {
  if (typeof FormData !== 'undefined' && b instanceof FormData) return 'formdata';
  if (typeof Blob !== 'undefined' && b instanceof Blob) return 'blob';
  if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return 'binary';
  if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return 'urlencoded';
  if (typeof ReadableStream !== 'undefined' && b instanceof ReadableStream) return 'stream';
  return 'other';
}

export function summarizeSse(text: string): NonNullable<FetchRecord['sse']> {
  const events = parseSse(text);
  const names = new Set<string>();
  let data: Shape | undefined;
  let sawDone = false;
  let nonJson = 0;
  for (const ev of events.slice(0, MAX_SSE_EVENTS)) {
    if (ev.event !== undefined) names.add(ev.event);
    const d = parseSseData(ev.data);
    if (d.kind === 'done') sawDone = true;
    else if (d.kind === 'text') nonJson++;
    else {
      const sh = shapeOf(d.value);
      data = data ? mergeShapes(data, sh) : sh;
    }
  }
  const out: NonNullable<FetchRecord['sse']> = { events: events.length, eventNames: [...names].sort(), sawDone, nonJson };
  if (data) out.data = data;
  return out;
}
