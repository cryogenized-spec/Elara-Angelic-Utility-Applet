/** Read-only retry metadata. Never used to replay mutations. */
export class RetryableReadError extends Error {
  constructor(message: string, readonly retryAfterMs = 0) { super(message); this.name = 'RetryableReadError'; }
}
export const MAX_READ_FAILURES = 5;
export const READ_TIMEOUT_MS = 120_000;
export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value || value.length > 128) return 0;
  const text = value.trim();
  const delay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  // Saturate numeric overflow rather than retrying before a provider cooldown.
  const maximum = Math.max(0, 8_640_000_000_000_000 - now);
  return Number.isNaN(delay) ? 0 : Math.max(0, Math.min(maximum, delay));
}
export function readRetryDelay(failures: number, minimum = 0, random = Math.random()): number {
  const exponential = Math.min(20 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1));
  return Math.max(minimum, Math.round(exponential * (0.8 + Math.max(0, Math.min(1, random)) * 0.2)));
}
