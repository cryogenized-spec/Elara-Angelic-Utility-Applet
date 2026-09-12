import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEDIA_INTENT,
  isMediaIntent,
  isMediaItem,
  mediaIntentOf,
  MEDIA_INTENTS,
  type MediaItem,
} from './media';

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    provider: 'youtube',
    id: 'abc123',
    kind: 'video',
    title: 'Lo-Fi Study Session',
    webUrl: 'https://www.youtube.com/watch?v=abc123',
    embedUrl: 'https://www.youtube-nocookie.com/embed/abc123?autoplay=0',
    ...overrides,
  };
}

describe('media intents', () => {
  it('recognises exactly the intents it can render', () => {
    expect(MEDIA_INTENTS).toEqual(['watch', 'listen']);
    expect(isMediaIntent('watch')).toBe(true);
    expect(isMediaIntent('listen')).toBe(true);
    expect(isMediaIntent(DEFAULT_MEDIA_INTENT)).toBe(true);
  });

  it('rejects everything else, including near-misses', () => {
    for (const value of ['Watch', 'WATCH', '', ' audio', 'stream', 1, null, undefined, {}, ['listen']]) {
      expect(isMediaIntent(value)).toBe(false);
    }
  });

  it('defaults to watch', () => {
    expect(DEFAULT_MEDIA_INTENT).toBe('watch');
    expect(mediaIntentOf(item())).toBe('watch');
    expect(mediaIntentOf(item({ intent: 'watch' }))).toBe('watch');
    expect(mediaIntentOf(item({ intent: 'listen' }))).toBe('listen');
  });

  it('resolves a nonsensical stored intent to the default rather than propagating it', () => {
    // Reachable only from damaged storage; the renderer must still land on a
    // hand-off it understands instead of an undefined code path.
    expect(mediaIntentOf({ intent: 'karaoke' as never })).toBe('watch');
    expect(mediaIntentOf({})).toBe('watch');
  });
});

describe('isMediaItem with an intent', () => {
  it('accepts an item with no intent at all', () => {
    // This is the load-bearing case, not a nicety: media items are persisted
    // inside conversation messages, so every message written before `intent`
    // existed has none. A validator that required it would erase those cards on
    // the next load, silently, for users who did nothing wrong.
    const legacy = { ...item() };
    expect('intent' in legacy).toBe(false);
    expect(isMediaItem(legacy)).toBe(true);
  });

  it('accepts each valid intent', () => {
    expect(isMediaItem(item({ intent: 'watch' }))).toBe(true);
    expect(isMediaItem(item({ intent: 'listen' }))).toBe(true);
  });

  it('rejects an item whose intent is present but unrecognised', () => {
    // Absent means "old data". Present-and-wrong means something upstream is
    // broken, and quietly rendering it as the default could hand a music request
    // to a video surface or vice versa.
    expect(isMediaItem(item({ intent: 'karaoke' as never }))).toBe(false);
    expect(isMediaItem(item({ intent: null as never }))).toBe(false);
    expect(isMediaItem(item({ intent: 0 as never }))).toBe(false);
  });

  it('still rejects the fields that were always required', () => {
    for (const broken of [
      { ...item(), webUrl: '' },
      { ...item(), embedUrl: undefined },
      { ...item(), kind: 'channel' },
      { ...item(), provider: 'vimeo' },
      { ...item(), intent: 'listen', title: '' },
    ]) {
      expect(isMediaItem(broken)).toBe(false);
    }
  });
});
