import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, describe, expect, it } from 'vitest';

const DB_NAME = 'elara-media-cache';

/**
 * Migration proof for installations that already have the Phase 0–6 v1 cache.
 * This file deliberately avoids importing `./storage` until the legacy database
 * exists, so the test exercises the real Dexie v1 -> v2 upgrade path.
 */
describe('media database schema', () => {
  it('adds the daily budget table without losing an existing v1 cache row', async () => {
    await Dexie.delete(DB_NAME);
    const legacy = new Dexie(DB_NAME);
    legacy.version(1).stores({ entries: 'key, expiresAt' });
    await legacy.open();
    await legacy.table('entries').put({
      key: 'youtube:v1:legacy-cache-row',
      provider: 'youtube',
      query: 'legacy cache row',
      normalizedQuery: 'legacy cache row',
      items: [],
      cachedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_600_000,
    });
    legacy.close();

    const { mediaDb } = await import('./storage');
    await mediaDb.open();

    expect(mediaDb.tables.map((table) => table.name).sort()).toEqual(['dailySearchBudget', 'entries']);
    expect(await mediaDb.entries.get('youtube:v1:legacy-cache-row')).toMatchObject({
      key: 'youtube:v1:legacy-cache-row',
      query: 'legacy cache row',
    });
    expect(await mediaDb.dailySearchBudget.count()).toBe(0);
  });
});

afterAll(async () => {
  const { mediaDb } = await import('./storage');
  mediaDb.close();
  await Dexie.delete(DB_NAME);
});
