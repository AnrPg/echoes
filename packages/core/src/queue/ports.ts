/**
 * Ports the scheduler needs from its host. Core never touches the network, timers or randomness directly, so the
 * same scheduler runs in the extension, a desktop app or a test with a fake clock.
 */

/** Minimal abort signal, structurally compatible with the platform `AbortSignal`. */
export interface SignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface TransportRequest {
  /** Absolute URL. The host decides which origins it allows; the extension allows only chatgpt.com. */
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: SignalLike;
}

/**
 * What the scheduler needs to see of a response to classify it. Hosts usually return a richer object (for example
 * the platform `Response`, which already satisfies this) and read the body themselves after the scheduler resolves.
 */
export interface TransportResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
}

/**
 * Sends one request and resolves with the response, whatever its status. Rejects only on network failure or abort.
 * The host owns credentials: tokens are added here, inside the host, and never pass through core.
 */
export type Transport<R extends TransportResponse = TransportResponse> = (request: TransportRequest) => Promise<R>;

/** Time source. The default uses `Date.now` and `setTimeout`; tests inject a fake. */
export interface Clock {
  now(): number;
  /** Resolve after `ms`, or reject with an `AbortError` when `signal` aborts. */
  sleep(ms: number, signal?: SignalLike): Promise<void>;
}

/** Returns a number in [0, 1). Defaults to `Math.random`; tests inject a fixed sequence. */
export type Random = () => number;

declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

/** Real clock based on `Date.now` and `setTimeout` (available in browsers, Node, Deno and Bun). */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const onAbort = () => {
        clearTimeout(handle);
        reject(abortError());
      };
      const handle = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

/** An `Error` named `AbortError`, matching what platform APIs throw on abort. */
export function abortError(message = 'The operation was aborted'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}
