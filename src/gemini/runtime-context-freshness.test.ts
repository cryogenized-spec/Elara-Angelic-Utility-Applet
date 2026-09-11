import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY,
  consumeRuntimeContextRefresh,
  readLastRuntimeContextRefresh,
  recordRuntimeContextRefresh,
  type RuntimeContextFreshnessStorage,
} from './runtime-context-freshness';
import { RUNTIME_CONTEXT_STALE_AFTER_MS } from './runtime-context';

/** Deterministic in-memory stand-in for localStorage (no clock, no sleeps). */
function memoryStorage(seed: Record<string, string> = {}): RuntimeContextFreshnessStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const NOW = 1_786_000_000_000;
const MINUTE = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime context freshness', () => {
  it('refreshes when no runtime-context refresh was ever recorded', () => {
    const storage = memoryStorage();
    expect(readLastRuntimeContextRefresh(storage)).toBeNull();
    expect(consumeRuntimeContextRefresh(NOW, storage)).toBe(true);
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW);
  });

  it('does not refresh 5 minutes after a refresh and leaves the timestamp untouched', () => {
    const storage = memoryStorage();
    expect(consumeRuntimeContextRefresh(NOW, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh(NOW + 5 * MINUTE, storage)).toBe(false);
    // The normal invocation did NOT advance the freshness window.
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW);
    expect(storage.data[RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY]).toBe(JSON.stringify({ lastRefreshAt: NOW }));
  });

  it('refreshes at every 30-minute boundary during hours of 5-minute invocations', () => {
    const storage = memoryStorage();
    // 10:00 → fresh, then every 5 minutes for 2+ hours: fresh again at
    // 10:30, 11:00, 11:30, 12:00 — normal turns never move the timestamp.
    const expectedRefreshes = [NOW, NOW + 30 * MINUTE, NOW + 60 * MINUTE, NOW + 90 * MINUTE, NOW + 120 * MINUTE];
    let lastRefresh = NOW;
    for (let at = NOW; at <= NOW + 125 * MINUTE; at += 5 * MINUTE) {
      const shouldRefresh = expectedRefreshes.includes(at);
      expect(consumeRuntimeContextRefresh(at, storage)).toBe(shouldRefresh);
      if (shouldRefresh) lastRefresh = at;
      expect(readLastRuntimeContextRefresh(storage)).toBe(lastRefresh);
    }
    expect(RUNTIME_CONTEXT_STALE_AFTER_MS).toBe(30 * MINUTE);
  });

  it('refreshes exactly 30 minutes after the last refresh', () => {
    const storage = memoryStorage();
    recordRuntimeContextRefresh(NOW, storage);
    expect(consumeRuntimeContextRefresh(NOW + 30 * MINUTE, storage)).toBe(true);
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW + 30 * MINUTE);
  });

  it('refreshes more than 30 minutes after the last refresh', () => {
    const storage = memoryStorage();
    recordRuntimeContextRefresh(NOW, storage);
    expect(consumeRuntimeContextRefresh(NOW + 30 * MINUTE + 1, storage)).toBe(true);
    const later = memoryStorage();
    recordRuntimeContextRefresh(NOW, later);
    expect(consumeRuntimeContextRefresh(NOW + 95 * MINUTE, later)).toBe(true);
  });

  it('does not refresh again for invocations within 30 minutes after a refresh', () => {
    const storage = memoryStorage();
    recordRuntimeContextRefresh(NOW, storage);
    const refreshedAt = NOW + 45 * MINUTE;
    expect(consumeRuntimeContextRefresh(refreshedAt, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh(refreshedAt + MINUTE, storage)).toBe(false);
    expect(consumeRuntimeContextRefresh(refreshedAt + 10 * MINUTE, storage)).toBe(false);
    expect(readLastRuntimeContextRefresh(storage)).toBe(refreshedAt);
  });

  it('respects the persisted refresh timestamp across app restart', () => {
    // Session 1 refreshes; session 2 starts with only the persisted bytes.
    const session1 = memoryStorage();
    expect(consumeRuntimeContextRefresh(NOW, session1)).toBe(true);
    const persisted = session1.data[RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY];
    expect(typeof persisted).toBe('string');

    const session2 = memoryStorage({ [RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY]: persisted });
    expect(consumeRuntimeContextRefresh(NOW + 10 * MINUTE, session2)).toBe(false);
    const session3 = memoryStorage(session2.data);
    expect(consumeRuntimeContextRefresh(NOW + 30 * MINUTE, session3)).toBe(true);
  });

  it('refreshes on the next invocation after the app was dead for hours, with no background work', () => {
    const storage = memoryStorage();
    recordRuntimeContextRefresh(NOW, storage);
    // Two hours of app death: merely observing freshness writes nothing.
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW);
    expect(storage.data[RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY]).toBe(JSON.stringify({ lastRefreshAt: NOW }));
    // The next invocation sees the stale timestamp and refreshes.
    expect(consumeRuntimeContextRefresh(NOW + 2 * 60 * MINUTE, storage)).toBe(true);
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW + 2 * 60 * MINUTE);
  });

  it('shares one freshness window across threads — switching threads never resets it', () => {
    // Freshness takes no thread identity: consecutive turns from any threads
    // share the application-level window.
    const storage = memoryStorage();
    expect(consumeRuntimeContextRefresh(NOW, storage)).toBe(true); // thread A initial
    expect(consumeRuntimeContextRefresh(NOW + 5 * MINUTE, storage)).toBe(false); // thread B
    expect(consumeRuntimeContextRefresh(NOW + 25 * MINUTE, storage)).toBe(false); // thread C
    expect(readLastRuntimeContextRefresh(storage)).toBe(NOW);
    expect(consumeRuntimeContextRefresh(NOW + 30 * MINUTE, storage)).toBe(true); // any thread
  });

  it('fails open to a refresh on malformed or foreign storage and self-heals', () => {
    for (const raw of ['{not json', '["array"]', '"string"', '42', JSON.stringify({ lastRefreshAt: 'not-a-number' }), JSON.stringify({})]) {
      const storage = memoryStorage({ [RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY]: raw });
      expect(consumeRuntimeContextRefresh(NOW, storage)).toBe(true);
      // The refresh overwrote the garbage with a valid timestamp.
      expect(readLastRuntimeContextRefresh(storage)).toBe(NOW);
    }
  });

  it('fails open to a refresh when storage is unavailable, without blocking the turn', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      // Deliberate compatibility choice: with nowhere to persist, every turn
      // refreshes (pre-freshness always-fresh behaviour) rather than starving
      // the model of clock context. Nothing is recorded.
      expect(consumeRuntimeContextRefresh(NOW)).toBe(true);
      expect(readLastRuntimeContextRefresh()).toBeNull();
      expect(() => recordRuntimeContextRefresh(NOW)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('persists only the refresh timestamp — no date/time payload, memory, or world state', () => {
    const storage = memoryStorage();
    expect(consumeRuntimeContextRefresh(NOW, storage)).toBe(true);
    const raw = storage.data[RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY];
    expect(raw).toBe(JSON.stringify({ lastRefreshAt: NOW }));
    expect(raw).not.toMatch(/date|time|weekday|timezone|memory|world|thread/i);
  });
});
