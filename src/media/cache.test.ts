import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CACHE_ENTRIES,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
  clearMediaCache,
  mediaCacheSize,
  readMediaCache,
  writeMediaCache,
} from './cache';
import type { MediaItem } from '../domain/media';

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

const VALUE = { provider: 'youtube', query: 'dark ambient', normalizedQuery: 'dark ambient' };

beforeEach(async () => {
  await clearMediaCache();
});

describe('media search cache', () => {
  it('returns a miss for an unknown key', async () => {
    expect(await readMediaCache('youtube:v1:never-written', NOW)).toEqual({ hit: false, items: [] });
  });

  it('round-trips items under a normalized key', async () => {
    await writeMediaCache('youtube:v1:dark ambient', { ...VALUE, items: [item('a'), item('b')] }, NOW);

    const read = await readMediaCache('youtube:v1:dark ambient', NOW);
    expect(read.hit).toBe(true);
    expect(read.items.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('gives a positive result the long TTL and an empty one the short TTL', async () => {
    await writeMediaCache('youtube:v1:hit', { ...VALUE, items: [item('a')] }, NOW);
    await writeMediaCache('youtube:v1:miss', { ...VALUE, items: [] }, NOW);

    // Just inside both windows.
    expect((await readMediaCache('youtube:v1:hit', NOW + POSITIVE_TTL_MS - 1)).hit).toBe(true);
    expect((await readMediaCache('youtube:v1:miss', NOW + NEGATIVE_TTL_MS - 1)).hit).toBe(true);

    // A negative result must be retried long before a positive one expires.
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
      await writeMediaCache(`youtube:v1:q${index}`, { ...VALUE, items: [item(`id${index}`)] }, NOW + index);
    }

    expect(await mediaCacheSize()).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
  });

  it('never stores credential material', async () => {
    // The only thing that reaches this store is rendered item data. Assert the
    // serialized record contains no key-shaped field, so a future field addition
    // that smuggles one in fails here.
    await writeMediaCache('youtube:v1:secret-check', { ...VALUE, items: [item('a')] }, NOW);

    const { readMediaCache: readBack } = await import('./cache');
    const read = await readBack('youtube:v1:secret-check', NOW);
    const serialized = JSON.stringify(read.items);
    expect(serialized).not.toMatch(/AIza/);
    expect(serialized).not.toMatch(/apiKey|api_key|x-goog/i);
    expect(Object.keys(read.items[0]).sort()).toEqual([
      'channel', 'embedUrl', 'id', 'kind', 'provider', 'title', 'webUrl',
    ]);
  });
});
