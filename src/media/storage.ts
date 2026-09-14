import Dexie, { type Table } from 'dexie';
import type { MediaItem } from '../domain/media';

export const MEDIA_DATABASE_NAME = 'elara-media-cache';

export interface MediaCacheEntry {
  key: string;
  provider: string;
  query: string;
  normalizedQuery: string;
  items: MediaItem[];
  cachedAt: number;
  expiresAt: number;
}

export interface MediaDailySearchBudgetEntry {
  id: 'youtube-search';
  quotaDay: string;
  spent: number;
  updatedAt: number;
}

/**
 * One storage authority for YouTube-search state.
 *
 * v1 is the already-shipped cache schema. v2 adds a single daily-budget row in
 * the same database instead of creating a competing persistence store. Dexie
 * read/write transactions on `dailySearchBudget` serialize reservations across
 * tabs, so BroadcastChannel can remain an optimisation rather than an authority.
 */
class MediaDatabase extends Dexie {
  entries!: Table<MediaCacheEntry, string>;
  dailySearchBudget!: Table<MediaDailySearchBudgetEntry, string>;

  constructor() {
    super(MEDIA_DATABASE_NAME);
    this.version(1).stores({ entries: 'key, expiresAt' });
    this.version(2).stores({
      entries: 'key, expiresAt',
      dailySearchBudget: 'id, quotaDay, updatedAt',
    });
  }
}

export const mediaDb = new MediaDatabase();
