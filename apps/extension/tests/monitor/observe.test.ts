import { describe, expect, it, vi } from 'vitest';
import type { CaptureRecord, FetchRecord } from '../../src/inspect/messages';
import { installObservers, type ObserveTarget } from '../../src/monitor/observe';

const BASE = 'https://chatgpt.com';
// Records are emitted after the response body clone is read, which takes several ticks.
const settle = (records: unknown[], n: number) => vi.waitFor(() => expect(records).toHaveLength(n));

function setup(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const records: CaptureRecord[] = [];
  const target: ObserveTarget = { fetch: vi.fn(impl) as unknown as typeof fetch };
  const orig = target.fetch;
  const uninstall = installObservers(target, (r) => records.push(r), { base: BASE });
  return { target, orig, records, uninstall };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

describe('installObservers (fetch)', () => {
  it('returns the original response untouched and records only shapes and header names', async () => {
    const { target, records } = setup(async () => json({ id: 'x', secret: 'My private words' }));
    const res = await target.fetch(`${BASE}/backend-api/thing/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b?limit=5`, {
      headers: { Authorization: 'Bearer TOKEN123' },
    });
    expect(await res.json()).toEqual({ id: 'x', secret: 'My private words' }); // body still readable by the page
    await settle(records, 1);
    const r = records[0] as FetchRecord;
    expect(r.method).toBe('GET');
    expect(r.url).toEqual({ host: 'chatgpt.com', path: '/backend-api/thing/:id', query: ['limit'] });
    expect(r.reqHeaders).toEqual(['authorization']);
    expect(r.status).toBe(200);
    expect(r.resContentType).toBe('application/json');
    const { raw, ...noRaw } = r;
    expect(JSON.stringify(noRaw)).not.toMatch(/TOKEN123|private/);
    expect(raw).toEqual({ id: 'x', secret: 'My private words' }); // forwarded; kept only if user enables raw mode
  });

  it('passes the original rejection through and records the error', async () => {
    const { target, records } = setup(async () => { throw new TypeError('Failed to fetch'); });
    await expect(target.fetch('/backend-api/x')).rejects.toThrow('Failed to fetch');
    await settle(records, 1);
    expect((records[0] as FetchRecord).error).toBe('TypeError');
  });

  it('forwards `this` and arguments unchanged', async () => {
    const seen: unknown[] = [];
    const target: ObserveTarget = {
      fetch: function (this: unknown, ...args: unknown[]) { seen.push(this, ...args); return Promise.resolve(new Response('')); } as unknown as typeof fetch,
    };
    installObservers(target, () => undefined, { base: BASE });
    const init = { method: 'POST', body: '{"a":1}' };
    await target.fetch.call(target, '/x', init);
    expect(seen).toEqual([target, '/x', init]);
  });

  it('captures the shape of JSON request bodies, from init and from Request objects', async () => {
    const { target, records } = setup(async () => new Response(null, { status: 204 }));
    await target.fetch('/backend-api/a', { method: 'post', body: JSON.stringify({ action: 'next', parts: ['hi there'] }), headers: { 'content-type': 'application/json' } });
    await target.fetch(new Request(`${BASE}/backend-api/b`, { method: 'PATCH', body: '{"is_visible":false}' }));
    await settle(records, 2);
    const [a, b] = records as FetchRecord[];
    expect(a!.method).toBe('POST');
    expect(a!.reqContentType).toBe('application/json');
    expect(a!.reqBody!.obj!.keys.action!.shape.str!.values).toEqual(['next']);
    expect(JSON.stringify(a)).not.toContain('hi there');
    expect(b!.reqBody!.obj!.keys.is_visible!.shape.kinds).toEqual(['bool']);
  });

  it('summarizes SSE streams and still lets the page read them', async () => {
    const stream = 'event: delta\ndata: {"v":"Hel"}\n\ndata: [DONE]\n\n';
    const { target, records } = setup(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
    const res = await target.fetch('/backend-api/stream', { method: 'POST', body: '{}' });
    expect(await res.text()).toBe(stream);
    await settle(records, 1);
    const r = records[0] as FetchRecord;
    expect(r.sse).toMatchObject({ events: 2, eventNames: ['delta'], sawDone: true, nonJson: 0 });
    expect(JSON.stringify(r)).not.toContain('Hel"');
  });

  it('skips static assets and does not raw-forward non-GET or non-backend responses', async () => {
    const { target, records } = setup(async () => json({ a: 1 }));
    await target.fetch('/_next/static/chunk.js');
    await target.fetch('/other/api');
    await settle(records, 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(records).toHaveLength(1);
    expect((records[0] as FetchRecord).raw).toBeUndefined();
  });

  it('uninstall restores the original fetch', () => {
    const { target, orig, uninstall } = setup(async () => json({}));
    expect(target.fetch).not.toBe(orig);
    uninstall();
    expect(target.fetch).toBe(orig);
  });
});

describe('installObservers (WebSocket)', () => {
  it('logs the URL template and keeps instanceof working', () => {
    class FakeWS { static OPEN = 1; constructor(public url: string | URL, public protocols?: string | string[]) {} }
    const records: CaptureRecord[] = [];
    const target = { fetch: (async () => new Response('')) as typeof fetch, WebSocket: FakeWS as unknown as typeof WebSocket };
    installObservers(target, (r) => records.push(r), { base: BASE });
    const ws = new target.WebSocket('wss://ws.example.com/socket/file-AbCdEf1234567890?token=SECRET');
    expect(ws).toBeInstanceOf(FakeWS);
    expect((target.WebSocket as unknown as { OPEN: number }).OPEN).toBe(1);
    expect(records[0]).toMatchObject({ kind: 'websocket', url: { host: 'ws.example.com', path: '/socket/:id', query: ['token'] } });
    expect(JSON.stringify(records)).not.toContain('SECRET');
  });
});
