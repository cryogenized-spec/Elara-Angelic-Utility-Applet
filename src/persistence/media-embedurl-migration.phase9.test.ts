import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { describe, expect, it } from 'vitest';
import { ElaraDatabase } from './conversation';
import { MediaDatabase } from '../media/storage';
import { isMediaItem } from '../domain/media';

const VIDEO_ID = 'a1B2c3D4e5F';
const FETCHED_AT = Date.UTC(2026, 8, 15, 0, 0, 0);

function legacyItem(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'youtube',
    id: VIDEO_ID,
    kind: 'video',
    title: 'Legacy Phase 9 video',
    channel: 'Migration Lab',
    webUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=0`,
    apiDataFetchedAt: FETCHED_AT,
    ...extra,
  };
}

class LegacyConversationV8 extends Dexie {
  messages!: Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(8).stores({
      messages: 'id, conversationId, createdAt, role',
      threads: 'id, updatedAt, archived',
      settings: 'id, updatedAt',
      workspaceShortcuts: 'id, service, enabled, order, updatedAt',
      folders: 'id, parentId, contextScope, updatedAt',
      folderAssignments: 'id, threadId, folderId, updatedAt',
      memories: 'id, kind, lifecycle, folderId, expiresAt, updatedAt, lastRecalledAt, autonomyContext',
      artifactMetadata: 'id, artifactType, provenance, status, createdAt, mimeType, sourceMessageId, toolName',
      artifactBlobs: 'id',
    });
  }
}

class LegacyMediaV2 extends Dexie {
  entries!: Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(2).stores({
      entries: 'key, expiresAt',
      dailySearchBudget: 'id, quotaDay, updatedAt',
    });
  }
}

describe('Phase 9 retired embedUrl migrations', () => {
  it('removes only embedUrl from v8 conversation media and preserves the rest of the raw row', async () => {
    const name = `elara-phase9-conversation-${crypto.randomUUID()}`;
    const legacy = new LegacyConversationV8(name);
    await legacy.open();
    await legacy.messages.put({
      id: 'legacy-media-message',
      role: 'assistant',
      text: 'Keep the conversation.',
      conversationId: 'primary',
      createdAt: 10,
      media: [legacyItem({ unexpectedLegacyField: 'still-untrusted' })],
    });
    legacy.close();

    const upgraded = new ElaraDatabase(name);
    await upgraded.open();
    const row = await upgraded.messages.get('legacy-media-message') as unknown as Record<string, unknown>;
    const media = row.media as Array<Record<string, unknown>>;

    expect(media).toHaveLength(1);
    expect(media[0]).not.toHaveProperty('embedUrl');
    expect(media[0]).toMatchObject({
      provider: 'youtube',
      id: VIDEO_ID,
      webUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      unexpectedLegacyField: 'still-untrusted',
    });
    expect(isMediaItem(media[0])).toBe(false);

    await upgraded.delete();
  });

  it('removes only embedUrl from v2 search-cache items without discarding a valid cached result', async () => {
    const name = `elara-phase9-media-${crypto.randomUUID()}`;
    const legacy = new LegacyMediaV2(name);
    await legacy.open();
    await legacy.entries.put({
      key: 'youtube:phase-9',
      provider: 'youtube',
      query: 'phase 9',
      normalizedQuery: 'phase 9',
      items: [legacyItem()],
      cachedAt: FETCHED_AT,
      expiresAt: FETCHED_AT + 60_000,
    });
    legacy.close();

    const upgraded = new MediaDatabase(name);
    await upgraded.open();
    const row = await upgraded.entries.get('youtube:phase-9') as unknown as Record<string, unknown>;
    const media = row.items as Array<Record<string, unknown>>;

    expect(media).toHaveLength(1);
    expect(media[0]).not.toHaveProperty('embedUrl');
    expect(isMediaItem(media[0])).toBe(true);
    expect(media[0]).toMatchObject({
      provider: 'youtube',
      id: VIDEO_ID,
      title: 'Legacy Phase 9 video',
      webUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      apiDataFetchedAt: FETCHED_AT,
    });

    await upgraded.delete();
  });

  it('rejects a new raw MediaItem that tries to reintroduce embedUrl outside migration', () => {
    expect(isMediaItem(legacyItem())).toBe(false);
    const { embedUrl: _retired, ...current } = legacyItem();
    expect(isMediaItem(current)).toBe(true);
  });
});
