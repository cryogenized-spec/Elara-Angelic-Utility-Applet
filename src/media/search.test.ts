import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMediaProvider, searchMedia } from './search';
import { resetSearchBudget, searchBudget } from './budget';
import { clearMediaCache, readMediaCache, writeMediaCache } from './cache';
import { mediaCacheKey } from './normalize';
import { YouTubeSearchError } from './youtube/service';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../domain/media';
import type { MediaItem, MediaProvider, MediaSearchOutcome } from '../domain/media';

const NOW = 1_700_000_000_000;

function item(id: string): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title: `Result ${id}`,
    channel: 'Channel',
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
  };
}

function fakeProvider(behaviour?: (query: string) => MediaSearchOutcome | never): { provider: MediaProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: MediaProvider = {
    id: 'youtube',
    async search(request) {
      calls.push(request.query);
      if (behaviour) return behaviour(request.query);
      return {
        query: request.query,
        normalizedQuery: request.query.toLowerCase(),
        items: [item(request.query.replace(/\s+/g, '-'))],
        source: 'network',
        truncated: false,
      };
    },
  };
  return { provider, calls };
}

const OPTIONS = { now: () => NOW };

beforeEach(async () => {
  await clearMediaCache();
  resetSearchBudget();
  resetMediaProvider();
});

describe('media search orchestration', () => {
  it('collapses duplicate queries in one batch into a single call', async () => {
    const { provider, calls } = fakeProvider();

    const result = await searchMedia(
      { queries: ['Dark Ambient', 'dark  ambient!', 'DARK AMBIENT', 'lofi beats'] },
      { ...OPTIONS, provider },
    );

    expect(calls).toEqual(['Dark Ambient', 'lofi beats']);
    expect(result.networkCalls).toBe(2);
    expect(result.outcomes).toHaveLength(2);
    expect(searchBudget().spent).toBe(2);
  });

  it('serves a cached query with no call and no budget', async () => {
    await writeMediaCache('youtube:v1:dark ambient', {
      provider: 'youtube',
      query: 'dark ambient',
      normalizedQuery: 'dark ambient',
      items: [item('cached')],
    }, NOW);

    const { provider, calls } = fakeProvider();
    const result = await searchMedia({ queries: ['Dark  Ambient'] }, { ...OPTIONS, provider });

    expect(calls).toEqual([]);
    expect(result.networkCalls).toBe(0);
    expect(result.outcomes[0].source).toBe('cache');
    expect(result.outcomes[0].items[0].id).toBe('cached');
    expect(searchBudget().spent).toBe(0);
  });

  it('writes results back to the cache so the next call is free', async () => {
    const { provider } = fakeProvider();
    await searchMedia({ queries: ['jazz piano'] }, { ...OPTIONS, provider });

    const cached = await readMediaCache('youtube:v1:jazz piano', NOW);
    expect(cached.hit).toBe(true);
    expect(cached.items[0].id).toBe('jazz-piano');
  });

  it('caches an empty result too, so a no-match does not re-spend quota', async () => {
    const { provider, calls } = fakeProvider(() => ({
      query: 'obscure thing',
      normalizedQuery: 'obscure thing',
      items: [],
      source: 'network',
      truncated: false,
    }));

    await searchMedia({ queries: ['obscure thing'] }, { ...OPTIONS, provider });
    const second = await searchMedia({ queries: ['obscure thing'] }, { ...OPTIONS, provider });

    expect(calls).toEqual(['obscure thing']);
    expect(second.outcomes[0].source).toBe('cache');
  });

  it('stops at the budget and reports why, without calling the provider', async () => {
    resetSearchBudget(1);
    const { provider, calls } = fakeProvider();

    const result = await searchMedia({ queries: ['one', 'two', 'three'] }, { ...OPTIONS, provider });

    expect(calls).toEqual(['one']);
    expect(result.networkCalls).toBe(1);
    expect(result.outcomes).toHaveLength(1);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].reason).toBe('budget-exhausted');
    expect(searchBudget().remaining).toBe(0);
  });

  it('reports a provider failure without sinking the rest of the batch', async () => {
    const { provider, calls } = fakeProvider((query) => {
      if (query === 'broken') throw new YouTubeSearchError('quota-exceeded', 'Quota is gone.', true);
      return {
        query,
        normalizedQuery: query,
        items: [item(query)],
        source: 'network',
        truncated: false,
      };
    });

    const result = await searchMedia({ queries: ['good', 'broken', 'also good'] }, { ...OPTIONS, provider });

    expect(calls).toEqual(['good', 'broken', 'also good']);
    expect(result.outcomes.map((outcome) => outcome.query)).toEqual(['good', 'also good']);
    expect(result.failures).toEqual([{
      query: 'broken',
      normalizedQuery: 'broken',
      reason: 'quota-exceeded',
      message: 'Quota is gone.',
    }]);
    expect(searchBudget().spent).toBe(3);
  });

  it('refunds only a failure explicitly proven to occur before dispatch', async () => {
    resetSearchBudget(1);
    const { provider } = fakeProvider(() => { throw new YouTubeSearchError('no-api-key', 'No key.'); });

    await searchMedia({ queries: ['a', 'b'] }, { ...OPTIONS, provider });

    expect(searchBudget().spent).toBe(0);
  });

  it('does not refund a post-dispatch HTTP failure', async () => {
    resetSearchBudget(2);
    const { provider } = fakeProvider(() => {
      throw new YouTubeSearchError('rate-limited', 'Rate limited.', true);
    });

    await searchMedia({ queries: ['a', 'b', 'c'] }, { ...OPTIONS, provider });

    // Both attempted requests remain spent; the third query is budget-blocked.
    expect(searchBudget().spent).toBe(2);
  });

  it('treats a cache read fault as a miss and still answers from the network', async () => {
    const { provider, calls } = fakeProvider();
    const cache = {
      read: async () => { throw new Error('IndexedDB exploded'); },
      write: async () => undefined,
    };

    const result = await searchMedia({ queries: ['dark ambient'] }, { ...OPTIONS, provider, cache });

    expect(calls).toEqual(['dark ambient']);
    expect(result.outcomes.map((outcome) => outcome.query)).toEqual(['dark ambient']);
    expect(result.failures).toEqual([]);
  });

  it('swallows a cache write fault rather than discarding a good result', async () => {
    const { provider } = fakeProvider();
    const cache = {
      read: async () => ({ hit: false, items: [] }),
      write: async () => { throw new Error('quota on the object store'); },
    };

    const result = await searchMedia({ queries: ['dark ambient'] }, { ...OPTIONS, provider, cache });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].source).toBe('network');
    expect(result.failures).toEqual([]);
  });

  it('caps a batch at the documented maximum number of queries', async () => {
    const { provider, calls } = fakeProvider();
    const queries = Array.from({ length: MAX_MEDIA_QUERIES_PER_CALL + 5 }, (_, index) => `query ${index}`);

    await searchMedia({ queries }, { ...OPTIONS, provider });

    expect(calls).toHaveLength(MAX_MEDIA_QUERIES_PER_CALL);
  });

  it('ignores blank queries entirely', async () => {
    const { provider, calls } = fakeProvider();

    const result = await searchMedia({ queries: ['', '   ', 'real query'] }, { ...OPTIONS, provider });

    expect(calls).toEqual(['real query']);
    expect(result.outcomes).toHaveLength(1);
  });

  it('rejects a non-list queries argument rather than guessing', async () => {
    const { provider } = fakeProvider();

    await expect(
      searchMedia({ queries: 'not a list' as unknown as string[] }, { ...OPTIONS, provider }),
    ).rejects.toMatchObject({ reason: 'invalid-request' });
  });

  it('returns frozen results a caller cannot mutate', async () => {
    const { provider } = fakeProvider();

    const result = await searchMedia({ queries: ['frozen'] }, { ...OPTIONS, provider });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.outcomes)).toBe(true);
  });
});

describe('media hand-off intent', () => {
  it('stamps the requested intent onto results fetched from the network', async () => {
    const { provider } = fakeProvider();

    const result = await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider });

    expect(result.outcomes[0].items.map((entry) => entry.intent)).toEqual(['listen']);
  });

  it('leaves results untagged when the caller asked for nothing', async () => {
    const { provider } = fakeProvider();

    const result = await searchMedia({ queries: ['lofi beats'] }, { ...OPTIONS, provider });

    expect('intent' in result.outcomes[0].items[0]).toBe(false);
  });

  it('stamps the intent onto a result served from cache', async () => {
    const { provider, calls } = fakeProvider();
    await searchMedia({ queries: ['lofi beats'] }, { ...OPTIONS, provider });

    const later = await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider });

    expect(calls).toEqual(['lofi beats']);
    expect(later.outcomes[0].source).toBe('cache');
    expect(later.outcomes[0].items[0].intent).toBe('listen');
  });

  it('costs one network call and one budget unit for the same query under both intents', async () => {
    // The invariant that keeps an intent from becoming a quota leak: the cached
    // answer is intent-free, so the second request is served without dispatch.
    const { provider, calls } = fakeProvider();

    const watch = await searchMedia({ queries: ['lofi beats'], intent: 'watch' }, { ...OPTIONS, provider });
    const listen = await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider });

    expect(calls).toEqual(['lofi beats']);
    expect(searchBudget().spent).toBe(1);
    expect(watch.outcomes[0].source).toBe('network');
    expect(listen.outcomes[0].source).toBe('cache');
  });

  it('does not persist the intent into the cache entry', async () => {
    // Deliberate: writing the stamped item would freeze whichever intent asked
    // first onto every later reader of the same query.
    const { provider } = fakeProvider();

    await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider });

    // Read at the same clock the write used: the fixture pins `now`, so asking
    // the real Date.now() would report the entry as long expired.
    const cached = await readMediaCache(mediaCacheKey('youtube', 'lofi beats'), NOW);
    expect(cached.hit).toBe(true);
    expect(cached.items).toHaveLength(1);
    expect('intent' in cached.items[0]).toBe(false);
  });

  it('does not mutate the provider result while stamping', async () => {
    const { provider } = fakeProvider();
    const seen: MediaItem[][] = [];
    const wrapped: MediaProvider = {
      id: 'youtube',
      async search(request) {
        const outcome = await provider.search(request);
        seen.push([...outcome.items]);
        return outcome;
      },
    };

    const result = await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider: wrapped });

    expect(seen[0][0].intent).toBeUndefined();
    expect(result.outcomes[0].items[0].intent).toBe('listen');
  });

  it('keeps a stamped outcome frozen, exactly as the provider returned it', async () => {
    // The network path rebuilds the outcome to restamp its items. If that build
    // dropped the freeze, a stamped result would be mutable where an unstamped
    // one is not, and mutation would go unnoticed until two screens disagreed.
    const frozenProvider: MediaProvider = {
      id: 'youtube',
      async search(request) {
        return Object.freeze({
          query: request.query,
          normalizedQuery: request.query,
          items: Object.freeze([item(request.query)]),
          source: 'network' as const,
          truncated: false,
        });
      },
    };

    const stamped = await searchMedia({ queries: ['lofi beats'], intent: 'listen' }, { ...OPTIONS, provider: frozenProvider });
    expect(Object.isFrozen(stamped.outcomes[0])).toBe(true);
    expect(Object.isFrozen(stamped.outcomes[0].items)).toBe(true);
    expect(Object.isFrozen(stamped.outcomes[0].items[0])).toBe(true);

    const untouched = await searchMedia({ queries: ['lofi beats'], intent: 'watch' }, { ...OPTIONS, provider: frozenProvider });
    expect(Object.isFrozen(untouched.outcomes[0])).toBe(true);
  });

  it('drops an unrecognised intent instead of guessing one', async () => {
    const { provider } = fakeProvider();

    const result = await searchMedia(
      { queries: ['lofi beats'], intent: 'gaming' as 'watch' },
      { ...OPTIONS, provider },
    );

    expect('intent' in result.outcomes[0].items[0]).toBe(false);
  });
});
