import { describe, expect, it } from 'vitest';
import { backoffDelay, parseRetryAfter } from '@echoes/core';

describe('backoffDelay', () => {
  it('doubles from 2s and caps at 60s', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map((n) => backoffDelay(n))).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });
  it('rejects non-positive attempts', () => {
    expect(() => backoffDelay(0)).toThrow(RangeError);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('reads delta seconds', () => expect(parseRetryAfter(' 120 ', now)).toBe(120_000));
  it('reads HTTP dates', () => expect(parseRetryAfter('Sat, 10 Oct 2026 12:00:30 GMT', now)).toBe(30_000));
  it('clamps past dates to 0', () => expect(parseRetryAfter('Sat, 10 Oct 2026 11:00:00 GMT', now)).toBe(0));
  it.each([null, undefined, '', '-5', '1.5', 'soon', '2026-10-10'])('ignores %j', (v) => {
    expect(parseRetryAfter(v, now)).toBeUndefined();
  });
});
