import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../domain/chat';
import { MEDIA_API_DATA_MAX_AGE_MS, type MediaItem } from '../domain/media';
import {
  createThread,
  db,
  loadConversation,
  pruneExpiredConversationMedia,
} from './conversation';

const NOW = 1_800_000_000_000;

function media(id: string, fetchedAt: number = NOW): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title: `Video ${id}`,
    channel: 'Channel',
    thumbnail: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 },
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
    apiDataFetchedAt: fetchedAt,
  };
}

function message(conversationId: string, item: MediaItem): ChatMessage {
  return {
    id: `assistant-${item.id}`,
    role: 'assistant',
    text: `Historical answer for ${item.id}`,
    conversationId,
    createdAt: NOW - 1_000,
    media: [item],
  };
}

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.messages.clear(),
    db.threads.clear(),
  ]);
});

describe('conversation media retention', () => {
  it('keeps fresh API metadata on load', async () => {
    const thread = await createThread('Fresh');
    await db.messages.put(message(thread.id, media('fresh', NOW - 1_000)));

    const loaded = await loadConversation(thread.id, NOW);

    expect(loaded.messages[0].media?.[0].id).toBe('fresh');
    expect((await db.messages.get('assistant-fresh'))?.media?.[0].id).toBe('fresh');
  });

  it('removes exactly-expired API metadata while preserving the chat message', async () => {
    const thread = await createThread('Stale');
    await db.messages.put(message(thread.id, media('stale', NOW - MEDIA_API_DATA_MAX_AGE_MS)));

    const loaded = await loadConversation(thread.id, NOW);

    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].text).toBe('Historical answer for stale');
    expect(loaded.messages[0].media).toBeUndefined();
    const stored = await db.messages.get('assistant-stale');
    expect(stored?.text).toBe('Historical answer for stale');
    expect(stored?.media).toBeUndefined();
  });

  it('treats legacy media with no API timestamp as untrusted', async () => {
    const thread = await createThread('Legacy');
    const legacy = { ...media('legacy') };
    delete (legacy as { apiDataFetchedAt?: number }).apiDataFetchedAt;
    await db.messages.put(message(thread.id, legacy));

    const loaded = await loadConversation(thread.id, NOW);

    expect(loaded.messages[0].media).toBeUndefined();
    expect((await db.messages.get('assistant-legacy'))?.media).toBeUndefined();
  });

  it('drops a corrupted media collection carrying unexpected credential-like fields', async () => {
    const thread = await createThread('Corrupt');
    const corruptItem = {
      ...media('corrupt'),
      apiKey: 'AIzaSy-should-never-survive-a-media-row',
    };
    const corruptMessage: ChatMessage = {
      id: 'assistant-corrupt',
      role: 'assistant',
      text: 'Keep this text.',
      conversationId: thread.id,
      createdAt: NOW,
      media: [corruptItem as unknown as MediaItem],
    };
    await db.messages.put(corruptMessage);

    const loaded = await loadConversation(thread.id, NOW);

    expect(loaded.messages[0].text).toBe('Keep this text.');
    expect(loaded.messages[0].media).toBeUndefined();
    expect(JSON.stringify(await db.messages.get('assistant-corrupt'))).not.toContain('AIzaSy');
  });

  it('drops malformed thumbnail metadata instead of repairing it', async () => {
    const thread = await createThread('Bad thumbnail');
    const malformed = {
      ...media('bad-thumb'),
      thumbnail: { url: 'https://i.ytimg.com/vi/bad-thumb/hqdefault.jpg', width: 0, height: 360 },
    } as MediaItem;
    await db.messages.put(message(thread.id, malformed));

    const loaded = await loadConversation(thread.id, NOW);

    expect(loaded.messages[0].media).toBeUndefined();
  });

  it('startup sweep cleans all threads without changing their updatedAt timestamps', async () => {
    const first = await createThread('One');
    const second = await createThread('Two');
    await db.messages.bulkPut([
      message(first.id, media('old-one', NOW - MEDIA_API_DATA_MAX_AGE_MS - 1)),
      message(second.id, media('old-two', NOW - MEDIA_API_DATA_MAX_AGE_MS - 1)),
    ]);
    const before = new Map((await db.threads.toArray()).map((thread) => [thread.id, thread.updatedAt]));

    const cleaned = await pruneExpiredConversationMedia(NOW);

    expect(cleaned).toBe(2);
    expect((await db.messages.get('assistant-old-one'))?.media).toBeUndefined();
    expect((await db.messages.get('assistant-old-two'))?.media).toBeUndefined();
    for (const thread of await db.threads.toArray()) {
      expect(thread.updatedAt).toBe(before.get(thread.id));
    }
  });
});
