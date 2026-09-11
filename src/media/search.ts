import type {
  MediaItem,
  MediaProvider,
  MediaSearchFailure,
  MediaSearchOutcome,
} from '../domain/media';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../domain/media';
import { dedupeMediaQueries, mediaCacheKey, normalizeMediaQuery } from './normalize';
import { hasSearchBudget, reserveSearch, releaseSearch } from './budget';
import { readMediaCache, writeMediaCache, type ReadMediaCacheResult } from './cache';
import { createYouTubeProvider, YouTubeSearchError } from './youtube/service';

/**
 * Media search orchestration.
 *
 * The order of operations is the whole point: dedupe, then cache, then budget,
 * and only then the network. A batch that repeats a cached query costs nothing
 * at all, which is what makes a per-session budget survivable against a provider
 * whose search endpoint has a small dedicated daily allowance.
 *
 * Failure policy: the cache is best effort in both directions. A read fault is
 * treated as a miss and a write fault is swallowed, because losing a cache entry
 * costs one API call while failing the search costs the user their answer.
 */

export interface MediaSearchBatchRequest {
  readonly queries: readonly string[];
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface MediaSearchBatchResult {
  readonly outcomes: readonly MediaSearchOutcome[];
  readonly failures: readonly MediaSearchFailure[];
  readonly networkCalls: number;
}

/** Test seam over the cache. Defaults to the real Dexie-backed store. */
export interface MediaCachePort {
  read(key: string, now: number): Promise<ReadMediaCacheResult>;
  write(
    key: string,
    value: { provider: string; query: string; normalizedQuery: string; items: readonly MediaItem[] },
    now: number,
  ): Promise<void>;
}

export interface MediaSearchOptions {
  readonly provider?: MediaProvider;
  readonly cache?: MediaCachePort;
  /** Resolves the YouTube key from the Lockbox unless a test supplies one. */
  readonly apiKey?: () => Promise<string>;
  readonly now?: () => number;
}

const realCache: MediaCachePort = {
  read: (key, now) => readMediaCache(key, now),
  write: (key, value, now) => writeMediaCache(key, value, now),
};

let cachedProvider: MediaProvider | undefined;

async function defaultApiKey(): Promise<string> {
  // Imported lazily so the Lockbox module is not a static dependency of the
  // media chunk, and so the key is resolved fresh on every search.
  const { getYouTubeApiKey } = await import('../persistence/gemini-api-key');
  return getYouTubeApiKey();
}

function defaultProvider(): MediaProvider {
  cachedProvider ??= createYouTubeProvider({ apiKey: defaultApiKey });
  return cachedProvider;
}

/** Test seam: drop the memoized provider so an injected one takes effect. */
export function resetMediaProvider(): void {
  cachedProvider = undefined;
}

export async function searchMedia(
  request: MediaSearchBatchRequest,
  options: MediaSearchOptions = {},
): Promise<MediaSearchBatchResult> {
  const provider = options.provider ?? defaultProvider();
  const cache = options.cache ?? realCache;
  const now = options.now ?? Date.now;

  if (!Array.isArray(request.queries)) {
    throw new YouTubeSearchError('invalid-request', 'Search queries must be provided as a list.');
  }

  const unique = dedupeMediaQueries(request.queries).slice(0, MAX_MEDIA_QUERIES_PER_CALL);
  const outcomes: MediaSearchOutcome[] = [];
  const failures: MediaSearchFailure[] = [];
  let networkCalls = 0;

  for (const query of unique) {
    const normalizedQuery = normalizeMediaQuery(query);
    const key = mediaCacheKey(provider.id, query);

    let cached: ReadMediaCacheResult = { hit: false, items: [] };
    try {
      cached = await cache.read(key, now());
    } catch {
      // A broken cache is a miss, not an error: fall through to the network.
    }

    if (cached.hit) {
      outcomes.push(Object.freeze({
        query: query.trim(),
        normalizedQuery,
        items: cached.items,
        source: 'cache' as const,
        truncated: false,
      }));
      continue;
    }

    // Cache miss: this one would cost a real API call, so gate it on budget.
    if (!hasSearchBudget()) {
      failures.push(Object.freeze({
        query: query.trim(),
        normalizedQuery,
        reason: 'budget-exhausted',
        message: 'This session has used its YouTube search allowance. Cached results still work; reload to reset the allowance.',
      }));
      continue;
    }

    if (!reserveSearch()) continue;
    try {
      const outcome = await provider.search({ query, limit: request.limit, signal: request.signal });
      networkCalls += 1;
      outcomes.push(outcome);
      try {
        await cache.write(key, {
          provider: provider.id,
          query: outcome.query,
          normalizedQuery: outcome.normalizedQuery,
          items: outcome.items,
        }, now());
      } catch {
        // Losing the write costs one future API call; it is not worth failing over.
      }
    } catch (error) {
      // The call may have failed before it left the browser; give the
      // reservation back so a configuration error does not burn the budget.
      releaseSearch();
      if (error instanceof YouTubeSearchError) {
        failures.push(Object.freeze({
          query: query.trim(),
          normalizedQuery,
          reason: error.reason,
          message: error.message,
        }));
        continue;
      }
      // An unexpected fault on one query must not sink the rest of the batch:
      // the model can still answer with whatever did resolve.
      failures.push(Object.freeze({
        query: query.trim(),
        normalizedQuery,
        reason: 'unknown',
        message: 'That YouTube search could not be completed.',
      }));
    }
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    failures: Object.freeze(failures),
    networkCalls,
  });
}
