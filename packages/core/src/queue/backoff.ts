/** Exponential backoff settings. Delays are base·2^(attempt-1), capped. Defaults: 2s, 4s, 8s, … up to 60s. */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 2_000, maxMs: 60_000 };

/**
 * Delay before retry number `attempt` (1-based).
 *
 * @example
 * ```ts
 * [1, 2, 3, 6].map((n) => backoffDelay(n)); // [2000, 4000, 8000, 60000]
 * ```
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
  return Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds from `nowMs`. Accepts delta-seconds (`"120"`) and HTTP dates
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns undefined when absent or unparseable, so the caller falls back to
 * backoff. A date in the past gives 0.
 *
 * @example
 * ```ts
 * parseRetryAfter('3', 0); // 3000
 * ```
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  // Date.parse also accepts loose formats like "5" or "2026"; require the IMF-fixdate shape's weekday and GMT.
  if (!/^[A-Za-z]{3}, .+ GMT$/.test(v)) return undefined;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}
