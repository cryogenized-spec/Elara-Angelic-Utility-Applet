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

function stripLegacyEmbedUrls(value: unknown): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false };
  let changed = false;
  const migrated = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'embedUrl')) return entry;
    const { embedUrl: _retired, ...withoutEmbedUrl } = record;
    changed = true;
    return withoutEmbedUrl;
  });
  return { value: migrated, changed };
}

/**
 * One storage authority for YouTube-search state.
 *
 * v1 is the already-shipped cache schema. v2 adds a single daily-budget row in
 * the same database instead of creating a competing persistence store. Dexie
 * read/write transactions on `dailySearchBudget` serialize reservations across
 * tabs, so BroadcastChannel can remain an optimisation rather than an authority.
 * v3 retires the old derived iframe URL without discarding otherwise-useful
 * cached search metadata.
 */
export class MediaDatabase extends Dexie {
  entries!: Table<MediaCacheEntry, string>;
  dailySearchBudget!: Table<MediaDailySearchBudgetEntry, string>;

  constructor(name = MEDIA_DATABASE_NAME) {
    super(name);
    this.version(1).stores({ entries: 'key, expiresAt' });
    this.version(2).stores({
      entries: 'key, expiresAt',
      dailySearchBudget: 'id, quotaDay, updatedAt',
    });
    this.version(3).stores({
      entries: 'key, expiresAt',
      dailySearchBudget: 'id, quotaDay, updatedAt',
    }).upgrade(async (transaction) => {
      await transaction.table('entries').toCollection().modify((entry: Record<string, unknown>) => {
        const migrated = stripLegacyEmbedUrls(entry.items);
        if (migrated.changed) entry.items = migrated.value;
      });
    });
  }
}

export const mediaDb = new MediaDatabase();
