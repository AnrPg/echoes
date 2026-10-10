import { describe, expect, it, vi } from 'vitest';
import {
  HttpError, RetriesExhaustedError, Scheduler, SchedulerCancelledError, isCloudflareChallenge,
  type SchedulerEvent, type TransportRequest, type TransportResponse,
} from '@echoes/core';
import { FakeClock, flush, res } from './helpers.ts';

type R = TransportResponse & { id: string };
const get = (url = 'https://chatgpt.com/x'): TransportRequest => ({ url, method: 'GET' });

function setup(responses: (R | Error)[], opts: { clock?: FakeClock; random?: () => number; maxRetries?: number } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const starts: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const transport = vi.fn(async (_req: TransportRequest): Promise<R> => {
    starts.push(clock.now());
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await flush();
    inFlight--;
    const next = responses.shift() ?? res(200);
    if (next instanceof Error) throw next;
    return next;
  });
  const events: SchedulerEvent[] = [];
  const scheduler = new Scheduler<R>({
    transport, clock, random: opts.random ?? (() => 0.5), intervalMs: 1000, jitterMs: 500,
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
  });
  scheduler.subscribe((e) => events.push(e));
  return { scheduler, transport, starts, events, clock, maxInFlight: () => maxInFlight };
}

describe('Scheduler spacing', () => {
  it('runs requests one at a time, interval + jitter apart, in order', async () => {
    const { scheduler, starts, maxInFlight } = setup([]);
    const urls = ['a', 'b', 'c'].map((u) => `https://chatgpt.com/${u}`);
    const results = await Promise.all(urls.map((u) => scheduler.request(get(u))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(starts).toEqual([0, 1250, 2500]); // 1000 + 0.5 * 500 jitter
    expect(maxInFlight()).toBe(1);
  });

  it('draws fresh jitter per request', async () => {
    const seq = [0, 0.99, 0.2];
    const { scheduler, starts } = setup([], { random: () => seq.shift()! });
    await Promise.all([1, 2, 3].map(() => scheduler.request(get())));
    expect(starts).toEqual([0, 1000, 1000 + 1495]);
  });
});

describe('Scheduler retries', () => {
  it('honors Retry-After on 429', async () => {
    const { scheduler, clock, events } = setup([res(429, { 'Retry-After': '7' })]);
    await scheduler.request(get());
    expect(clock.sleeps).toContain(7000);
    expect(events.find((e) => e.type === 'retry')).toMatchObject({ attempt: 1, delayMs: 7000, status: 429 });
  });

  it('backs off exponentially on 5xx without Retry-After', async () => {
    const { scheduler, clock } = setup([res(503), res(502), res(500)]);
    await scheduler.request(get());
    expect(clock.sleeps.filter((s) => s >= 2000)).toEqual([2000, 4000, 8000]);
  });

  it('retries network errors, then gives up with RetriesExhaustedError', async () => {
    const { scheduler, transport } = setup([new TypeError('Failed to fetch'), res(500), res(500)], { maxRetries: 2 });
    const err = await scheduler.request(get()).catch((e) => e);
    expect(err).toBeInstanceOf(RetriesExhaustedError);
    expect(err).toMatchObject({ attempts: 3, lastStatus: 500 });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('does not retry other 4xx', async () => {
    const { scheduler, transport } = setup([res(404)]);
    const err = await scheduler.request(get()).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.response.id).toBe('r404');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps going with the next request after a failure', async () => {
    const { scheduler } = setup([res(404), res(200)]);
    const [a, b] = await Promise.allSettled([scheduler.request(get()), scheduler.request(get())]);
    expect(a.status).toBe('rejected');
    expect(b).toMatchObject({ status: 'fulfilled', value: { status: 200 } });
  });
});

describe('Scheduler pauses on auth and bot checks', () => {
  it.each<[string, R, string]>([
    ['401', res(401), 'auth'],
    ['403 HTML', res(403, { 'content-type': 'text/html; charset=UTF-8' }), 'challenge'],
    ['cf-mitigated', res(503, { 'cf-mitigated': 'challenge' }), 'challenge'],
  ])('%s pauses the whole queue until resume()', async (_n, first, reason) => {
    const { scheduler, transport, events } = setup([first]);
    const p1 = scheduler.request(get('https://chatgpt.com/1'));
    const p2 = scheduler.request(get('https://chatgpt.com/2'));
    for (let i = 0; i < 5; i++) await flush();
    expect(scheduler.state).toBe('paused');
    expect(scheduler.pauseReason).toBe(reason);
    expect(transport).toHaveBeenCalledTimes(1); // never auto-retried, and the next request waits too
    expect(events.some((e) => e.type === 'retry')).toBe(false);

    scheduler.resume();
    expect((await p1).status).toBe(200);
    expect((await p2).status).toBe(200);
    expect(transport.mock.calls.map(([r]) => r.url)).toEqual([
      'https://chatgpt.com/1', 'https://chatgpt.com/1', 'https://chatgpt.com/2',
    ]);
  });

  it('a plain JSON 403 is an HttpError, not a challenge', async () => {
    const { scheduler } = setup([res(403, { 'content-type': 'application/json' })]);
    await expect(scheduler.request(get())).rejects.toBeInstanceOf(HttpError);
    expect(isCloudflareChallenge(res(403, { 'content-type': 'application/json' }))).toBe(false);
  });
});

describe('Scheduler abort and cancel', () => {
  it('a request aborted while queued never reaches the transport', async () => {
    const { scheduler, transport } = setup([]);
    const ctrl = new AbortController();
    const p1 = scheduler.request(get('https://chatgpt.com/1'));
    const p2 = scheduler.request({ ...get('https://chatgpt.com/2'), signal: ctrl.signal });
    ctrl.abort();
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    await p1;
    await flush();
    expect(transport.mock.calls.map(([r]) => r.url)).toEqual(['https://chatgpt.com/1']);
  });

  it('an already-aborted signal rejects at once', async () => {
    const { scheduler } = setup([]);
    await expect(scheduler.request({ ...get(), signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancel() rejects queued, sleeping and paused requests and refuses new ones', async () => {
    const clock = new FakeClock('manual');
    const { scheduler, events } = setup([res(500)], { clock });
    const p1 = scheduler.request(get('https://chatgpt.com/1'));
    const p2 = scheduler.request(get('https://chatgpt.com/2'));
    for (let i = 0; i < 5; i++) await flush();
    expect(clock.sleeps).toEqual([2000]); // p1 is sleeping in backoff
    scheduler.cancel();
    await expect(p1).rejects.toBeInstanceOf(SchedulerCancelledError);
    await expect(p2).rejects.toBeInstanceOf(SchedulerCancelledError);
    await expect(scheduler.request(get())).rejects.toBeInstanceOf(SchedulerCancelledError);
    expect(scheduler.state).toBe('cancelled');
    expect(events.at(-1)).toEqual({ type: 'cancelled' });
  });

  it('cancel() while paused settles everything', async () => {
    const { scheduler } = setup([res(401)]);
    const p = scheduler.request(get());
    for (let i = 0; i < 5; i++) await flush();
    expect(scheduler.state).toBe('paused');
    scheduler.cancel();
    await expect(p).rejects.toBeInstanceOf(SchedulerCancelledError);
  });

  it('a throwing listener does not stall the queue', async () => {
    const { scheduler } = setup([]);
    scheduler.subscribe(() => {
      throw new Error('boom');
    });
    expect((await scheduler.request(get())).status).toBe(200);
  });
});
