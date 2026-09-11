import Dexie, { type Table } from 'dexie';
import type { MediaItem } from '../domain/media';

/**
 * Client-side media search cache.
 *
 * This replaces the shared server cache the design originally assumed. Since the
 * browser now calls the YouTube Data API directly with the user's own key, there
 * is no server that could cache across users — so caching moves to the client,
 * where it is also the only place that can be keyed by the user's own budget.
 *
 * Two properties are load-bearing:
 *  - Cache values contain only rendered `MediaItem` data. No credential ever
 *    reaches this store; that is asserted by test.
 *  - Negative results are cached too, briefly. A query that legitimately
 *    returned nothing must not re-spend scarce `search.list` calls on retry.
 */

const DB_NAME = 'elara-media-cache';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Positive results stay useful for about a week. */
export const POSITIVE_TTL_MS = 7 * DAY_MS;
/** Negative results are retried soon; they are usually a phrasing problem. */
export const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** Keep the store bounded so a long-lived installation does not grow forever. */
export const MAX_CACHE_ENTRIES = 200;

export interface MediaCacheEntry {
  key: string;
  provider: string;
  query: string;
  normalizedQuery: string;
  items: MediaItem[];
  cachedAt: number;
  expiresAt: number;
}

class MediaCacheDatabase extends Dexie {
  entries!: Table<MediaCacheEntry, string>;
  constructor() {
    super(DB_NAME);
    this.version(1).stores({ entries: 'key, expiresAt' });
  }
}

const db = new MediaCacheDatabase();

export interface ReadMediaCacheResult {
  readonly hit: boolean;
  readonly items: readonly MediaItem[];
}

/**
 * Read a cached answer. An expired entry counts as a miss and is removed, so a
 * stale hit can never be mistaken for a fresh one.
 */
export async function readMediaCache(key: string, now: number = Date.now()): Promise<ReadMediaCacheResult> {
  const record = await db.entries.get(key);
  if (!record) return { hit: false, items: [] };
  if (record.expiresAt <= now) {
    await db.entries.delete(key).catch(() => undefined);
    return { hit: false, items: [] };
  }
  return { hit: true, items: Object.freeze(record.items.map((item) => Object.freeze({ ...item }))) };
}

export async function writeMediaCache(
  key: string,
  value: { provider: string; query: string; normalizedQuery: string; items: readonly MediaItem[] },
  now: number = Date.now(),
): Promise<void> {
  const ttl = value.items.length > 0 ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  const record: MediaCacheEntry = {
    key,
    provider: value.provider,
    query: value.query,
    normalizedQuery: value.normalizedQuery,
    // Copy out of the caller's array: a later mutation must not rewrite history.
    items: value.items.map((item) => ({ ...item })),
    cachedAt: now,
    expiresAt: now + ttl,
  };
  await db.entries.put(record);
  await pruneMediaCache(now);
}

/**
 * Drop expired rows, then the oldest rows if the store is still over the cap.
 * Best effort: a pruning failure must never fail the search that triggered it.
 */
async function pruneMediaCache(now: number): Promise<void> {
  try {
    await db.entries.where('expiresAt').belowOrEqual(now).delete();
    const count = await db.entries.count();
    if (count <= MAX_CACHE_ENTRIES) return;
    const overflow = count - MAX_CACHE_ENTRIES;
    const oldest = await db.entries.orderBy('expiresAt').limit(overflow).primaryKeys();
    if (oldest.length) await db.entries.bulkDelete(oldest as string[]);
  } catch {
    // Cache hygiene is not worth failing a user-visible search over.
  }
}

export async function clearMediaCache(): Promise<void> {
  await db.entries.clear();
}

export async function mediaCacheSize(): Promise<number> {
  return db.entries.count();
}
