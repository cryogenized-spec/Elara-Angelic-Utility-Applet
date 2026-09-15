import { describe, expect, it } from 'vitest';
import {
  MEDIA_API_DATA_MAX_AGE_MS,
  freshMediaItems,
  isFreshMediaItem,
  isMediaItem,
  type MediaItem,
} from '../domain/media';

const NOW = 1_800_000_000_000;

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    provider: 'youtube',
    id: 'abc123',
    kind: 'video',
    title: 'Result',
    thumbnail: { url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg', width: 480, height: 360 },
    webUrl: 'https://www.youtube.com/watch?v=abc123',
    apiDataFetchedAt: NOW - 1,
    ...overrides,
  };
}

describe('media API-data freshness contract', () => {
  it('accepts fresh provider data but rejects the exact 30-day boundary', () => {
    expect(isFreshMediaItem(item(), NOW)).toBe(true);
    expect(isFreshMediaItem(item({ apiDataFetchedAt: NOW - MEDIA_API_DATA_MAX_AGE_MS + 1 }), NOW)).toBe(true);
    expect(isFreshMediaItem(item({ apiDataFetchedAt: NOW - MEDIA_API_DATA_MAX_AGE_MS }), NOW)).toBe(false);
  });

  it('fails closed for missing and future timestamps', () => {
    expect(isFreshMediaItem(item({ apiDataFetchedAt: undefined }), NOW)).toBe(false);
    expect(isFreshMediaItem(item({ apiDataFetchedAt: NOW + 1 }), NOW)).toBe(false);
  });

  it('rejects unexpected fields instead of carrying credential-like material', () => {
    const poisoned = {
      ...item(),
      apiKey: 'AIzaSy-never-media-data',
    };
    expect(isMediaItem(poisoned)).toBe(false);
    expect(freshMediaItems([poisoned], NOW)).toEqual([]);
  });

  it('rejects malformed thumbnails and provider text instead of repairing them', () => {
    expect(isMediaItem(item({
      thumbnail: { url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg', width: 0, height: 360 },
    }))).toBe(false);
    expect(isMediaItem(item({ title: 'x'.repeat(1_001) }))).toBe(false);
  });

  it('rejects unsafe stored URL schemes at the structural boundary', () => {
    expect(isMediaItem(item({ webUrl: 'javascript:alert(1)' }))).toBe(false);
    expect(isMediaItem(item({ webUrl: 'data:text/html,hello' }))).toBe(false);
    expect(isMediaItem(item({ webUrl: 'http://www.youtube.com/watch?v=abc123' }))).toBe(false);
  });
});
