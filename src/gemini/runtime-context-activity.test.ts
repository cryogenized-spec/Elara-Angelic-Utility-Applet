import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY,
  consumeRuntimeContextRefresh,
  readRuntimeContextActivity,
  recordRuntimeContextActivity,
  type RuntimeContextActivityStorage,
} from './runtime-context-activity';
import { RUNTIME_CONTEXT_STALE_AFTER_MS } from './runtime-context';

/** Deterministic in-memory stand-in for localStorage (no clock, no sleeps). */
function memoryStorage(seed: Record<string, string> = {}): RuntimeContextActivityStorage & { data: Record<string, string> } {
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

describe('runtime context activity', () => {
  it('treats a new thread as a refresh and records its first invocation', () => {
    const storage = memoryStorage();
    expect(readRuntimeContextActivity('thread-new', storage)).toBeNull();
    expect(consumeRuntimeContextRefresh('thread-new', NOW, storage)).toBe(true);
    expect(readRuntimeContextActivity('thread-new', storage)).toBe(NOW);
  });

  it('does not refresh normal consecutive turns but keeps recording activity', () => {
    const storage = memoryStorage();
    expect(consumeRuntimeContextRefresh('thread-1', NOW, storage)).toBe(true);
    const second = NOW + 5 * MINUTE;
    expect(consumeRuntimeContextRefresh('thread-1', second, storage)).toBe(false);
    // Activity advanced even though no refresh happened: the boundary measures
    // inactivity between invocations, not time since the last refresh.
    expect(readRuntimeContextActivity('thread-1', storage)).toBe(second);
    const third = second + 5 * MINUTE;
    expect(consumeRuntimeContextRefresh('thread-1', third, storage)).toBe(false);
  });

  it('never refreshes a continuously active thread, however long the session runs', () => {
    const storage = memoryStorage();
    let at = NOW;
    expect(consumeRuntimeContextRefresh('thread-busy', at, storage)).toBe(true);
    // Two hours of five-minute turns: every gap is inside the window.
    for (let turn = 0; turn < 24; turn += 1) {
      at += 5 * MINUTE;
      expect(consumeRuntimeContextRefresh('thread-busy', at, storage)).toBe(false);
    }
  });

  it('refreshes below, at, and above the 30-minute inactivity boundary', () => {
    // Each probe starts from identical recorded activity: every consume
    // records, so sharing one store across probes would shift the boundary.
    const probe = (atMs: number): boolean => {
      const storage = memoryStorage();
      recordRuntimeContextActivity('thread-idle', NOW, storage);
      return consumeRuntimeContextRefresh('thread-idle', atMs, storage);
    };
    expect(probe(NOW + 29 * MINUTE + 59_999)).toBe(false);
    expect(probe(NOW + 30 * MINUTE)).toBe(true);
    expect(probe(NOW + 90 * MINUTE)).toBe(true);
    expect(RUNTIME_CONTEXT_STALE_AFTER_MS).toBe(30 * MINUTE);
  });

  it('resumes normal existing-thread behaviour for turns after a refresh', () => {
    const storage = memoryStorage();
    consumeRuntimeContextRefresh('thread-1', NOW, storage);
    const refreshedAt = NOW + 45 * MINUTE;
    expect(consumeRuntimeContextRefresh('thread-1', refreshedAt, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh('thread-1', refreshedAt + MINUTE, storage)).toBe(false);
    expect(consumeRuntimeContextRefresh('thread-1', refreshedAt + 10 * MINUTE, storage)).toBe(false);
  });

  it('tracks threads independently', () => {
    const storage = memoryStorage();
    consumeRuntimeContextRefresh('thread-a', NOW, storage);
    expect(consumeRuntimeContextRefresh('thread-b', NOW + MINUTE, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh('thread-a', NOW + MINUTE, storage)).toBe(false);
  });

  it('restores existing-thread state from persisted storage across sessions', () => {
    // Session 1 records activity; session 2 starts with only the persisted bytes.
    const session1 = memoryStorage();
    consumeRuntimeContextRefresh('thread-restored', NOW, session1);
    const persisted = session1.data[RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY];
    expect(typeof persisted).toBe('string');

    const session2 = memoryStorage({ [RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY]: persisted });
    // 10 minutes later: existing thread, no refresh.
    expect(consumeRuntimeContextRefresh('thread-restored', NOW + 10 * MINUTE, session2)).toBe(false);
    // 30+ minutes after the last RECORDED activity: refresh on next invocation.
    const session3 = memoryStorage(session2.data);
    expect(consumeRuntimeContextRefresh('thread-restored', NOW + 10 * MINUTE + 30 * MINUTE, session3)).toBe(true);
  });

  it('survives malformed or foreign storage without blocking the turn', () => {
    expect(consumeRuntimeContextRefresh('thread-1', NOW, memoryStorage({ [RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY]: '{not json' }))).toBe(true);
    expect(consumeRuntimeContextRefresh('thread-1', NOW, memoryStorage({ [RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY]: '["array"]' }))).toBe(true);
    const mixed = memoryStorage({ [RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY]: JSON.stringify({ 'thread-1': 'not-a-number', 'thread-2': NOW }) });
    expect(consumeRuntimeContextRefresh('thread-1', NOW, mixed)).toBe(true);
    expect(consumeRuntimeContextRefresh('thread-2', NOW, mixed)).toBe(false);
  });

  it('fails open to a refresh when there is no thread identity', () => {
    const storage = memoryStorage();
    expect(consumeRuntimeContextRefresh(null, NOW, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh(undefined, NOW, storage)).toBe(true);
    expect(consumeRuntimeContextRefresh('', NOW, storage)).toBe(true);
    expect(storage.data).toEqual({});
  });

  it('fails open to a refresh when no storage is available', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      expect(consumeRuntimeContextRefresh('thread-1', NOW)).toBe(true);
      expect(readRuntimeContextActivity('thread-1')).toBeNull();
      expect(() => recordRuntimeContextActivity('thread-1', NOW)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stores only activity timestamps — never the clock, memory, or world state', () => {
    const storage = memoryStorage();
    consumeRuntimeContextRefresh('thread-1', NOW, storage);
    const raw = storage.data[RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY];
    expect(raw).toBe(JSON.stringify({ 'thread-1': NOW }));
    expect(raw).not.toMatch(/date|time|weekday|timezone|memory|world/i);
  });
});
