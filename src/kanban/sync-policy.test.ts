import { describe, expect, it } from 'vitest';
import { readRetryDelay, retryAfterMilliseconds } from './sync-policy';

describe('read backoff policy', () => {
  it('handles delta-seconds and HTTP-date Retry-After values', () => {
    const now = Date.parse('2026-09-18T10:00:00Z');
    expect(retryAfterMilliseconds('120', now)).toBe(120000);
    expect(retryAfterMilliseconds('Fri, 18 Sep 2026 10:02:00 GMT', now)).toBe(120000);
    expect(retryAfterMilliseconds('Fri, 18 Sep 2026 09:00:00 GMT', now)).toBe(0);
    expect(retryAfterMilliseconds(null, now)).toBe(0);
    expect(retryAfterMilliseconds('invalid', now)).toBe(0);
    const huge = retryAfterMilliseconds('9'.repeat(100), now);
    expect(huge).toBe(8_640_000_000_000_000 - now);
    expect(Number.isFinite(new Date(now + huge).getTime())).toBe(true);
  });
  it('bounds exponential jitter and never shortens a provider cooldown', () => {
    expect(readRetryDelay(1, 0, 0)).toBe(24000);
    expect(readRetryDelay(1, 0, 1)).toBe(30000);
    expect(readRetryDelay(30, 0, 1)).toBe(1200000);
    expect(readRetryDelay(1, 600000, 0)).toBe(600000);
  });
});
