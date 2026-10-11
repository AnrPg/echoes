// A Clock whose waits run in a dedicated worker (timer.worker.ts), so a bulk export keeps its pace while the export
// tab is hidden. Falls back to the page's own timers if the worker cannot start.

import { abortError, systemClock, type Clock } from '@echoes/core';

/** The part of a Worker the clock uses; tests pass a fake. */
export interface TimerPort {
  postMessage(message: { id: number; ms: number } | { id: number; cancel: true }): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export function workerClock(port: TimerPort): Clock {
  let seq = 0;
  const waiting = new Map<number, () => void>();
  port.onmessage = (e) => {
    const done = typeof e.data === 'number' ? waiting.get(e.data) : undefined;
    done?.();
  };
  return {
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const id = ++seq;
        const onAbort = () => {
          waiting.delete(id);
          port.postMessage({ id, cancel: true });
          reject(abortError());
        };
        waiting.set(id, () => {
          waiting.delete(id);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        port.postMessage({ id, ms });
      }),
  };
}

/** The worker-backed clock, or the page's timers when workers are unavailable. */
export function backgroundSafeClock(): Clock {
  try {
    return workerClock(new Worker(new URL('./timer.worker.ts', import.meta.url), { type: 'module' }) as unknown as TimerPort);
  } catch {
    return systemClock;
  }
}
