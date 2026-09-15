import { describe, expect, it } from 'vitest';
import type { MediaItem } from './media';
import {
  DEFAULT_MEDIA_PLAYBACK_PREFERENCE,
  INITIAL_PLAYBACK_STATE,
  normalizeMediaPlaybackPreference,
  playbackReducer,
} from './playback';

const ITEM: MediaItem = {
  provider: 'youtube',
  id: 'phase2Video',
  kind: 'video',
  title: 'Phase 2 Track',
  channel: 'Authority Channel',
  thumbnail: { url: 'https://i.ytimg.com/vi/phase2Video/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=phase2Video',
  apiDataFetchedAt: 1_800_000_000_000,
  intent: 'listen',
};

describe('Phase 2 playback domain', () => {
  it('defaults unknown playback preferences to ask', () => {
    expect(DEFAULT_MEDIA_PLAYBACK_PREFERENCE).toBe('ask');
    expect(normalizeMediaPlaybackPreference('embedded')).toBe('embedded');
    expect(normalizeMediaPlaybackPreference('external')).toBe('external');
    expect(normalizeMediaPlaybackPreference('surprise')).toBe('ask');
    expect(normalizeMediaPlaybackPreference({})).toBe('ask');
  });

  it('runs the explicit legal lifecycle without changing request lineage', () => {
    const selected = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
    expect(selected).toMatchObject({ phase: 'requested', requestId: 'request-a', error: null });
    expect(selected.item).not.toBe(ITEM);
    expect(selected.item?.thumbnail).not.toBe(ITEM.thumbnail);

    const checking = playbackReducer(selected, { type: 'begin-check', requestId: 'request-a' });
    const ready = playbackReducer(checking, { type: 'ready', requestId: 'request-a' });
    const loading = playbackReducer(ready, { type: 'begin-load', requestId: 'request-a' });
    const playing = playbackReducer(loading, { type: 'play', requestId: 'request-a' });
    const paused = playbackReducer(playing, { type: 'pause', requestId: 'request-a' });
    const resumed = playbackReducer(paused, { type: 'play', requestId: 'request-a' });
    const ended = playbackReducer(resumed, { type: 'end', requestId: 'request-a' });
    const replayLoading = playbackReducer(ended, { type: 'begin-load', requestId: 'request-a' });

    expect([checking.phase, ready.phase, loading.phase, playing.phase, paused.phase, resumed.phase, ended.phase, replayLoading.phase])
      .toEqual(['checking', 'ready', 'loading', 'playing', 'paused', 'playing', 'ended', 'loading']);
    expect(replayLoading.requestId).toBe('request-a');
  });

  it('fails closed on illegal and out-of-order transitions', () => {
    const idlePlay = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'play', requestId: 'request-a' });
    expect(idlePlay).toBe(INITIAL_PLAYBACK_STATE);

    const selected = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
    expect(playbackReducer(selected, { type: 'play', requestId: 'request-a' })).toBe(selected);
    expect(playbackReducer(selected, { type: 'ready', requestId: 'request-a' })).toBe(selected);
    expect(playbackReducer(selected, { type: 'pause', requestId: 'request-a' })).toBe(selected);
  });

  it('makes a newer selection authoritative over every late event from the old request', () => {
    const a = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
    const aChecking = playbackReducer(a, { type: 'begin-check', requestId: 'request-a' });
    const bItem = { ...ITEM, id: 'phase2VideoB', title: 'Track B', webUrl: 'https://www.youtube.com/watch?v=phase2VideoB' };
    const b = playbackReducer(aChecking, { type: 'select', requestId: 'request-b', item: bItem });

    expect(b).toMatchObject({ phase: 'requested', requestId: 'request-b' });
    for (const late of [
      { type: 'ready', requestId: 'request-a' } as const,
      { type: 'begin-load', requestId: 'request-a' } as const,
      { type: 'play', requestId: 'request-a' } as const,
      { type: 'pause', requestId: 'request-a' } as const,
      { type: 'end', requestId: 'request-a' } as const,
      { type: 'fail', requestId: 'request-a', error: 'late failure' } as const,
    ]) {
      expect(playbackReducer(b, late)).toBe(b);
    }
  });

  it('rejects malformed selection identities and malformed media without disturbing state', () => {
    expect(playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: ' contains spaces ', item: ITEM })).toBe(INITIAL_PLAYBACK_STATE);
    expect(playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: { ...ITEM, webUrl: 'javascript:alert(1)' } })).toBe(INITIAL_PLAYBACK_STATE);
  });

  it('bounds and normalizes failure text', () => {
    const selected = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
    const failed = playbackReducer(selected, { type: 'fail', requestId: 'request-a', error: `  ${'provider\nsecret '.repeat(100)}  ` });
    expect(failed.phase).toBe('failed');
    expect(failed.error).toHaveLength(320);
    expect(failed.error).not.toContain('\n');

    const generic = playbackReducer(selected, { type: 'fail', requestId: 'request-a', error: { raw: 'body' } });
    expect(generic.error).toBe('Playback failed.');
  });

  it('reset clears every request-owned field from any active phase', () => {
    const selected = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
    const failed = playbackReducer(selected, { type: 'fail', requestId: 'request-a', error: 'nope' });
    expect(playbackReducer(failed, { type: 'reset' })).toBe(INITIAL_PLAYBACK_STATE);
  });
});
