import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CACHE_ENTRIES,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
  clearMediaCache,
  mediaCacheSize,
  pruneMediaCache,
  readMediaCache,
  writeMediaCache,
} from './cache';
import { MEDIA_API_DATA_MAX_AGE_MS, type MediaItem } from '../domain/media';

const NOW = 1_700_000_000_000;

function item(id: string, apiDataFetchedAt: number = NOW): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title: `Result ${id}`,
    channel: 'Channel',
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
    apiDataFetchedAt,
  };
}

const VALUE = { provider: 'youtube', query: 'dark ambient', normalizedQuery: 'dark ambient' };

beforeEach(async () => {
  await clearMediaCache();
});

describe('media search cache', () => {
  it('returns a miss for an unknown key', async () => {
    expect(await readMediaCache('youtube:v1:never-written', NOW)).toEqual({ hit: false, items: [] });
  });

  it('round-trips fresh items under a normalized key without changing the API timestamp', async () => {
    await writeMediaCache('youtube:v1:dark ambient', { ...VALUE, items: [item('a'), item('b')] }, NOW);

    const read = await readMediaCache('youtube:v1:dark ambient', NOW + 1_000);
    expect(read.hit).toBe(true);
    expect(read.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(read.items.map((entry) => entry.apiDataFetchedAt)).toEqual([NOW, NOW]);
  });

  it('gives a positive result the long cache TTL and an empty one the short TTL', async () => {
    await writeMediaCache('youtube:v1:hit', { ...VALUE, items: [item('a')] }, NOW);
    await writeMediaCache('youtube:v1:miss', { ...VALUE, items: [] }, NOW);

    expect((await readMediaCache('youtube:v1:hit', NOW + POSITIVE_TTL_MS - 1)).hit).toBe(true);
    expect((await readMediaCache('youtube:v1:miss', NOW + NEGATIVE_TTL_MS - 1)).hit).toBe(true);

    expect((await readMediaCache('youtube:v1:miss', NOW + NEGATIVE_TTL_MS + 1)).hit).toBe(false);
    expect((await readMediaCache('youtube:v1:hit', NOW + NEGATIVE_TTL_MS + 1)).hit).toBe(true);
  });

  it('treats an expired entry as a miss and removes it', async () => {
    await writeMediaCache('youtube:v1:stale', { ...VALUE, items: [item('a')] }, NOW);
    expect(await mediaCacheSize()).toBe(1);

    const read = await readMediaCache('youtube:v1:stale', NOW + POSITIVE_TTL_MS + 1);

    expect(read.hit).toBe(false);
    expect(await mediaCacheSize()).toBe(0);
  });

  it('physically prunes expired rows even when nobody reads that query again', async () => {
    await writeMediaCache('youtube:v1:orphaned', { ...VALUE, items: [item('a')] }, NOW);
    expect(await mediaCacheSize()).toBe(1);

    await pruneMediaCache(NOW + POSITIVE_TTL_MS + 1);

    expect(await mediaCacheSize()).toBe(0);
  });

  it('refuses legacy-undated or API-data-stale positive rows', async () => {
    const legacy = { ...item('legacy') } as MediaItem;
    delete (legacy as { apiDataFetchedAt?: number }).apiDataFetchedAt;
    const stale = item('stale', NOW - MEDIA_API_DATA_MAX_AGE_MS);

    await writeMediaCache('youtube:v1:legacy', { ...VALUE, items: [legacy] }, NOW);
    await writeMediaCache('youtube:v1:api-stale', { ...VALUE, items: [stale] }, NOW);

    expect(await mediaCacheSize()).toBe(0);
    expect((await readMediaCache('youtube:v1:legacy', NOW)).hit).toBe(false);
    expect((await readMediaCache('youtube:v1:api-stale', NOW)).hit).toBe(false);
  });

  it('caches negative results so a no-match query does not re-spend a call', async () => {
    await writeMediaCache('youtube:v1:obscure', { ...VALUE, items: [] }, NOW);

    const read = await readMediaCache('youtube:v1:obscure', NOW + 1000);
    expect(read.hit).toBe(true);
    expect(read.items).toEqual([]);
  });

  it('does not let the caller mutate cached history afterwards', async () => {
    const items = [item('a')];
    await writeMediaCache('youtube:v1:copy', { ...VALUE, items }, NOW);
    items.push(item('b'));

    const read = await readMediaCache('youtube:v1:copy', NOW);
    expect(read.items.map((entry) => entry.id)).toEqual(['a']);
  });

  it('hands back frozen items so the UI cannot rewrite the store', async () => {
    await writeMediaCache('youtube:v1:frozen', { ...VALUE, items: [item('a')] }, NOW);

    const read = await readMediaCache('youtube:v1:frozen', NOW);
    expect(Object.isFrozen(read.items)).toBe(true);
    expect(Object.isFrozen(read.items[0])).toBe(true);
  });

  it('keeps the store bounded', async () => {
    for (let index = 0; index < MAX_CACHE_ENTRIES + 25; index += 1) {
      const timestamp = NOW + index;
      await writeMediaCache(`youtube:v1:q${index}`, { ...VALUE, items: [item(`id${index}`, timestamp)] }, timestamp);
    }

    expect(await mediaCacheSize()).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
  });

  it('never stores credential material', async () => {
    await writeMediaCache('youtube:v1:secret-check', { ...VALUE, items: [item('a')] }, NOW);

    const read = await readMediaCache('youtube:v1:secret-check', NOW);
    const serialized = JSON.stringify(read.items);
    expect(serialized).not.toMatch(/AIza/);
    expect(serialized).not.toMatch(/apiKey|api_key|x-goog/i);
    expect(Object.keys(read.items[0]).sort()).toEqual([
      'apiDataFetchedAt', 'channel', 'embedUrl', 'id', 'kind', 'provider', 'title', 'webUrl',
    ]);
  });
});
