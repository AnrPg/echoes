import { backoffDelay, DEFAULT_BACKOFF, parseRetryAfter, type BackoffOptions } from './backoff.ts';
import {
  abortError,
  systemClock,
  type Clock,
  type Random,
  type SignalLike,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './ports.ts';

/** Why the scheduler stopped on its own: the session expired, or a bot check (Cloudflare challenge) appeared. */
export type PauseReason = 'auth' | 'challenge';

export type SchedulerState = 'running' | 'paused' | 'cancelled';

export type SchedulerEvent =
  | { type: 'request'; url: string; attempt: number }
  | { type: 'response'; url: string; status: number }
  | { type: 'retry'; url: string; attempt: number; delayMs: number; status?: number; error?: unknown }
  | { type: 'paused'; reason: PauseReason; url: string; status: number }
  | { type: 'resumed' }
  | { type: 'cancelled' };

export interface SchedulerOptions<R extends TransportResponse> {
  transport: Transport<R>;
  clock?: Clock;
  random?: Random;
  /** Minimum gap between request starts. Default 1000 ms. */
  intervalMs?: number;
  /** Random extra gap in [0, jitterMs). Default 500 ms. */
  jitterMs?: number;
  /** Retries after a 429, 5xx or network error, per request. Default 5. Auth and challenge pauses do not count. */
  maxRetries?: number;
  backoff?: BackoffOptions;
  /** Decides whether a response is a bot check. Default: see {@link isCloudflareChallenge}. */
  isChallenge?: (response: R) => boolean;
}

/** A non-retryable error status (4xx other than 401 and 429, or a plain 403). The response is attached. */
export class HttpError<R extends TransportResponse = TransportResponse> extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly url: string;
  readonly response: R;
  constructor(url: string, response: R) {
    super(`HTTP ${response.status} for ${url}`);
    this.status = response.status;
    this.url = url;
    this.response = response;
  }
}

/** Every retry was used up on 429, 5xx or network errors. `lastStatus` is absent if the last failure was a network error. */
export class RetriesExhaustedError extends Error {
  override readonly name = 'RetriesExhaustedError';
  readonly url: string;
  readonly attempts: number;
  readonly lastStatus: number | undefined;
  constructor(url: string, attempts: number, lastStatus?: number, options?: { cause?: unknown }) {
    super(`Gave up on ${url} after ${attempts} attempts${lastStatus ? ` (last status ${lastStatus})` : ''}`, options);
    this.url = url;
    this.attempts = attempts;
    this.lastStatus = lastStatus;
  }
}

/** The scheduler was cancelled before this request completed. */
export class SchedulerCancelledError extends Error {
  override readonly name = 'SchedulerCancelledError';
}

/**
 * Default bot-check detection: Cloudflare's `cf-mitigated: challenge` header, or a 403 whose body is HTML (an API
 * endpoint answers JSON, so HTML means an interstitial page).
 */
export function isCloudflareChallenge(r: TransportResponse): boolean {
  if (r.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return true;
  return r.status === 403 && (r.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

interface Task<R> {
  request: TransportRequest;
  resolve(r: R): void;
  reject(e: unknown): void;
  settled: boolean;
}

/**
 * The single, polite request queue. Requests run one at a time, never in parallel, at least `intervalMs` plus
 * jitter apart. 429 and 5xx are retried after `Retry-After` or exponential backoff. A 401 or a bot challenge
 * **pauses** the whole queue: nothing is retried until the user has refreshed or logged in and the host calls
 * {@link Scheduler.resume}.
 *
 * Create one scheduler per host and send every request through it, attachment downloads included; two schedulers
 * would double the request rate.
 *
 * @example
 * ```ts
 * const scheduler = new Scheduler({ transport: (req) => fetch(req.url, req) });
 * scheduler.subscribe((e) => { if (e.type === 'paused') askUserToLogIn(e.reason); });
 * const res = await scheduler.request({ url, method: 'GET' });
 * ```
 */
export class Scheduler<R extends TransportResponse = TransportResponse> {
  private readonly transport: Transport<R>;
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly intervalMs: number;
  private readonly jitterMs: number;
  private readonly maxRetries: number;
  private readonly backoff: BackoffOptions;
  private readonly isChallenge: (r: R) => boolean;

  private readonly queue: Task<R>[] = [];
  private readonly listeners = new Set<(e: SchedulerEvent) => void>();
  private readonly cancelSignal = new Signal();
  private _state: SchedulerState = 'running';
  private _pauseReason: PauseReason | undefined;
  private wake: (() => void) | undefined;
  private pumping = false;
  private nextStartAt = -Infinity;

  constructor(opts: SchedulerOptions<R>) {
    this.transport = opts.transport;
    this.clock = opts.clock ?? systemClock;
    this.random = opts.random ?? Math.random;
    this.intervalMs = opts.intervalMs ?? 1_000;
    this.jitterMs = opts.jitterMs ?? 500;
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.isChallenge = opts.isChallenge ?? isCloudflareChallenge;
  }

  get state(): SchedulerState {
    return this._state;
  }

  /** Set while `state` is `'paused'`. */
  get pauseReason(): PauseReason | undefined {
    return this._pauseReason;
  }

  /** Requests queued or in flight. */
  get pending(): number {
    return this.queue.length;
  }

  /** Listen to scheduler events. Returns an unsubscribe function. Listener errors are ignored. */
  subscribe(listener: (e: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Queue a request. Resolves with the response once it has a non-error status (below 400). Rejects with
   * {@link HttpError}, {@link RetriesExhaustedError}, {@link SchedulerCancelledError}, or an `AbortError` when
   * `request.signal` aborts. While paused, the promise stays pending until {@link resume} or {@link cancel}.
   */
  request(request: TransportRequest): Promise<R> {
    if (this._state === 'cancelled') return Promise.reject(new SchedulerCancelledError('Scheduler was cancelled'));
    return new Promise<R>((resolve, reject) => {
      const task: Task<R> = { request, settled: false, resolve, reject };
      const settle = (fn: () => void) => {
        if (task.settled) return;
        task.settled = true;
        request.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => settle(() => reject(abortError()));
      task.resolve = (r) => settle(() => resolve(r));
      task.reject = (e) => settle(() => reject(e));
      if (request.signal?.aborted) return reject(abortError());
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(task);
      void this.pump();
    });
  }

  /** Continue after a pause, once the user has refreshed or logged in. The request that hit the pause runs again. */
  resume(): void {
    if (this._state !== 'paused') return;
    this._state = 'running';
    this._pauseReason = undefined;
    this.emit({ type: 'resumed' });
    this.wake?.();
  }

  /** Stop for good: every queued and in-flight request rejects with {@link SchedulerCancelledError}. */
  cancel(): void {
    if (this._state === 'cancelled') return;
    this._state = 'cancelled';
    this._pauseReason = undefined;
    this.cancelSignal.abort();
    for (const task of this.queue.splice(0)) task.reject(new SchedulerCancelledError('Scheduler was cancelled'));
    this.emit({ type: 'cancelled' });
    this.wake?.();
  }

  private emit(e: SchedulerEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // A broken listener must not stall the queue.
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && this._state !== 'cancelled') {
        const task = this.queue[0]!;
        if (!task.settled) await this.run(task);
        if (this.queue[0] === task) this.queue.shift();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Runs one task to completion. Never throws: outcomes go to the task. */
  private async run(task: Task<R>): Promise<void> {
    const { url } = task.request;
    let failures = 0;
    for (;;) {
      if (this._state === 'paused') await new Promise<void>((r) => (this.wake = r));
      if (this.isCancelled() || task.settled) return;

      const signal = Signal.any([this.cancelSignal, task.request.signal]);
      try {
        const wait = this.nextStartAt - this.clock.now();
        if (wait > 0) await this.clock.sleep(wait, signal);
        if (task.settled) return;
        this.nextStartAt = this.clock.now() + this.intervalMs + this.random() * this.jitterMs;

        this.emit({ type: 'request', url, attempt: failures + 1 });
        let response: R;
        try {
          response = await this.transport(task.request);
        } catch (error) {
          if (isAbort(error) || task.settled || this.isCancelled()) throw error;
          failures++;
          if (failures > this.maxRetries) {
            return task.reject(new RetriesExhaustedError(url, failures, undefined, { cause: error }));
          }
          const delayMs = backoffDelay(failures, this.backoff);
          this.emit({ type: 'retry', url, attempt: failures, delayMs, error });
          await this.clock.sleep(delayMs, signal);
          continue;
        }
        if (task.settled || this.isCancelled()) return;
        const { status } = response;
        this.emit({ type: 'response', url, status });

        const challenge = this.isChallenge(response);
        if (challenge || status === 401) {
          this.pause(challenge ? 'challenge' : 'auth', url, status);
          continue;
        }
        if (status === 429 || status >= 500) {
          failures++;
          if (failures > this.maxRetries) return task.reject(new RetriesExhaustedError(url, failures, status));
          const delayMs =
            parseRetryAfter(response.headers.get('retry-after'), this.clock.now()) ?? backoffDelay(failures, this.backoff);
          this.emit({ type: 'retry', url, attempt: failures, delayMs, status });
          await this.clock.sleep(delayMs, signal);
          continue;
        }
        if (status >= 400) return task.reject(new HttpError(url, response));
        return task.resolve(response);
      } catch (error) {
        // Aborted by the task's own signal or by cancel(); the task is already settled in both cases.
        if (this.isCancelled()) return task.reject(new SchedulerCancelledError('Scheduler was cancelled'));
        return task.reject(isAbort(error) ? error : abortError());
      } finally {
        signal.dispose();
      }
    }
  }

  /** A method, not a field read, so TypeScript does not narrow away state changes made across awaits. */
  private isCancelled(): boolean {
    return this._state === 'cancelled';
  }

  private pause(reason: PauseReason, url: string, status: number): void {
    this._state = 'paused';
    this._pauseReason = reason;
    this.emit({ type: 'paused', reason, url, status });
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Tiny abort signal so core needs no platform `AbortController` types. */
class Signal implements SignalLike {
  aborted = false;
  private readonly listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];

  static any(sources: (SignalLike | undefined)[]): Signal {
    const s = new Signal();
    for (const src of sources) {
      if (!src) continue;
      if (src.aborted) s.abort();
      const fn = () => s.abort();
      src.addEventListener('abort', fn);
      s.cleanup.push(() => src.removeEventListener('abort', fn));
    }
    return s;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const l of [...this.listeners]) l();
  }

  addEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }

  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.listeners.clear();
  }
}
