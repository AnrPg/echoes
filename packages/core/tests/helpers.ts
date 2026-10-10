import { readFileSync } from 'node:fs';
import { abortError, type Clock, type Conversation, type SignalLike, type TransportResponse } from '@echoes/core';

export function sampleJson(): Conversation {
  return JSON.parse(readFileSync(new URL('../examples/sample-conversation.json', import.meta.url), 'utf8'));
}

/**
 * Fake clock. In `auto` mode every sleep advances time at once. In `manual` mode sleeps stay pending until
 * `advance()`, which lets tests abort or cancel mid-sleep.
 */
export class FakeClock implements Clock {
  t = 0;
  readonly sleeps: number[] = [];
  private pending: { until: number; resolve(): void }[] = [];
  private readonly mode: "auto" | "manual";
  constructor(mode: "auto" | "manual" = "auto") {
    this.mode = mode;
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: SignalLike): Promise<void> {
    this.sleeps.push(ms);
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.mode === 'auto') {
      this.t += ms;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = { until: this.t + ms, resolve };
      this.pending.push(entry);
      signal?.addEventListener('abort', () => {
        this.pending = this.pending.filter((p) => p !== entry);
        reject(abortError());
      });
    });
  }

  advance(ms: number): void {
    this.t += ms;
    const due = this.pending.filter((p) => p.until <= this.t);
    this.pending = this.pending.filter((p) => p.until > this.t);
    for (const p of due) p.resolve();
  }
}

export function res(status: number, headers: Record<string, string> = {}): TransportResponse & { id: string } {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => h.get(n.toLowerCase()) ?? null }, id: `r${status}` };
}

/** Let pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
