import { describe, expect, it } from 'vitest';
import { keepTabsAwake, type TabsApi } from '../../src/host/keep-awake';
import { workerClock, type TimerPort } from '../../src/host/worker-clock';

/** A worker stand-in: runs the timers itself and answers like timer.worker.ts. */
function fakeWorker(): TimerPort & { posted: unknown[] } {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const port: TimerPort & { posted: unknown[] } = {
    posted: [],
    onmessage: null,
    postMessage(m) {
      port.posted.push(m);
      if ('cancel' in m) return void clearTimeout(timers.get(m.id));
      timers.set(m.id, setTimeout(() => port.onmessage?.({ data: m.id }), m.ms));
    },
  };
  return port;
}

describe('workerClock', () => {
  it('waits through the worker', async () => {
    const w = fakeWorker();
    const clock = workerClock(w);
    const start = Date.now();
    await clock.sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
    expect(w.posted).toEqual([{ id: 1, ms: 30 }]);
  });

  it('cancels the worker timer on abort', async () => {
    const w = fakeWorker();
    const ac = new AbortController();
    const p = workerClock(w).sleep(10_000, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.posted).toEqual([{ id: 1, ms: 10_000 }, { id: 1, cancel: true }]);
  });

  it('keeps parallel waits apart', async () => {
    const clock = workerClock(fakeWorker());
    const order: number[] = [];
    await Promise.all([clock.sleep(40).then(() => order.push(40)), clock.sleep(5).then(() => order.push(5))]);
    expect(order).toEqual([5, 40]);
  });
});

describe('keepTabsAwake', () => {
  function fakeTabs(tabs: Record<number, boolean>): TabsApi & { tabs: Record<number, boolean> } {
    return {
      tabs,
      get: async (id) => {
        if (!(id in tabs)) throw new Error('No tab');
        return { id, autoDiscardable: tabs[id] };
      },
      update: async (id, props) => void (tabs[id] = props.autoDiscardable),
    };
  }

  it('marks tabs not discardable and restores them', async () => {
    const api = fakeTabs({ 1: true, 2: true });
    const release = await keepTabsAwake(api, [1, 2, 1]);
    expect(api.tabs).toEqual({ 1: false, 2: false });
    await release();
    expect(api.tabs).toEqual({ 1: true, 2: true });
  });

  it('leaves tabs already kept, and skips closed or unknown tabs', async () => {
    const api = fakeTabs({ 1: false });
    const release = await keepTabsAwake(api, [1, 9, undefined]);
    await release();
    expect(api.tabs).toEqual({ 1: false });
  });
});
