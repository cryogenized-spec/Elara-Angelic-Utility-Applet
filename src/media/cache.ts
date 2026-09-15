import { freshMediaItems, isFreshMediaItem, type MediaItem } from '../domain/media';
import { mediaDb, type MediaCacheEntry } from './storage';

export type { MediaCacheEntry } from './storage';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Positive results stay useful for about a week. */
export const POSITIVE_TTL_MS = 7 * DAY_MS;
/** Negative results are retried soon; they are usually a phrasing problem. */
export const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** Keep the store bounded so a long-lived installation does not grow forever. */
export const MAX_CACHE_ENTRIES = 200;

export interface ReadMediaCacheResult {
  readonly hit: boolean;
  readonly items: readonly MediaItem[];
}

function cacheEntryIsUsable(record: MediaCacheEntry, now: number): boolean {
  if (!Number.isFinite(record.cachedAt) || !Number.isFinite(record.expiresAt) || record.cachedAt <= 0 || record.expiresAt <= record.cachedAt || record.expiresAt <= now) return false;
  if (!Array.isArray(record.items)) return false;
  // Empty arrays are legitimate short-lived negative-cache entries. Any positive
  // row must be wholly fresh and structurally valid; a partially corrupted row
  // is discarded rather than converted into a misleading partial search result.
  return record.items.length === 0 || record.items.every((item) => isFreshMediaItem(item, now));
}

/**
 * Read a cached answer. Expired, malformed, legacy-undated or API-data-stale rows
 * are removed and reported as misses, so cache storage can never bypass the
 * provider-data freshness boundary.
 */
export async function readMediaCache(key: string, now: number = Date.now()): Promise<ReadMediaCacheResult> {
  const record = await mediaDb.entries.get(key);
  if (!record) return { hit: false, items: [] };
  if (!cacheEntryIsUsable(record, now)) {
    await mediaDb.entries.delete(key).catch(() => undefined);
    return { hit: false, items: [] };
  }
  return {
    hit: true,
    items: Object.freeze(record.items.map((item) => Object.freeze({
      ...item,
      ...(item.thumbnail ? { thumbnail: Object.freeze({ ...item.thumbnail }) } : {}),
    }))),
  };
}

export async function writeMediaCache(
  key: string,
  value: { provider: string; query: string; normalizedQuery: string; items: readonly MediaItem[] },
  now: number = Date.now(),
): Promise<void> {
  if (!Number.isFinite(now) || now <= 0) return;
  // A cache is an optimisation, not a place to launder malformed/undated API
  // data into a trusted result. Refuse the whole positive row if any item fails.
  const safeItems = freshMediaItems(value.items, now);
  if (value.items.length > 0 && safeItems.length !== value.items.length) return;

  const ttl = value.items.length > 0 ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  const record: MediaCacheEntry = {
    key,
    provider: value.provider,
    query: value.query,
    normalizedQuery: value.normalizedQuery,
    items: safeItems.map((item) => ({
      ...item,
      ...(item.thumbnail ? { thumbnail: { ...item.thumbnail } } : {}),
    })),
    cachedAt: now,
    expiresAt: now + ttl,
  };
  await mediaDb.entries.put(record);
  await pruneMediaCache(now);
}

/**
 * Physical cache hygiene used both after writes and on app startup. Unlike the
 * read guard, this visits rows the user may never search again, so expired or
 * corrupt API data does not linger indefinitely in IndexedDB.
 *
 * Best effort by design: a cache-maintenance failure must not prevent the app
 * from opening or a successful search from being shown.
 */
export async function pruneMediaCache(now: number = Date.now()): Promise<void> {
  try {
    const rows = await mediaDb.entries.toArray();
    const invalidKeys = rows.filter((record) => !cacheEntryIsUsable(record, now)).map((record) => record.key);
    if (invalidKeys.length) await mediaDb.entries.bulkDelete(invalidKeys);

    const count = await mediaDb.entries.count();
    if (count <= MAX_CACHE_ENTRIES) return;
    const overflow = count - MAX_CACHE_ENTRIES;
    const oldest = await mediaDb.entries.orderBy('expiresAt').limit(overflow).primaryKeys();
    if (oldest.length) await mediaDb.entries.bulkDelete(oldest as string[]);
  } catch {
    // Cache hygiene is not worth failing a user-visible search over.
  }
}

export async function clearMediaCache(): Promise<void> {
  await mediaDb.entries.clear();
}

export async function mediaCacheSize(): Promise<number> {
  return mediaDb.entries.count();
}
