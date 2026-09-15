import { describe, expect, it } from 'vitest';
import type { MediaItem } from './media';
import { INITIAL_PLAYBACK_STATE, playbackReducer } from './playback';

const ITEM: MediaItem = {
  provider: 'youtube',
  id: 'a1B2c3D4e5F',
  kind: 'video',
  title: 'Phase 4 Track',
  channel: 'Player Channel',
  thumbnail: { url: 'https://i.ytimg.com/vi/a1B2c3D4e5F/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
  apiDataFetchedAt: 1_800_000_000_000,
  intent: 'watch',
};

function loadingState() {
  const selected = playbackReducer(INITIAL_PLAYBACK_STATE, { type: 'select', requestId: 'request-a', item: ITEM });
  const checking = playbackReducer(selected, { type: 'begin-check', requestId: 'request-a' });
  const ready = playbackReducer(checking, { type: 'ready', requestId: 'request-a' });
  return playbackReducer(ready, { type: 'begin-load', requestId: 'request-a' });
}

describe('Phase 4 iframe lifecycle', () => {
  it('represents a loaded native player awaiting user input as paused', () => {
    const loading = loadingState();
    const playerReady = playbackReducer(loading, { type: 'pause', requestId: 'request-a' });
    expect(playerReady.phase).toBe('paused');
  });

  it('accepts native replay directly from ended without replacing request lineage', () => {
    const loading = loadingState();
    const playing = playbackReducer(loading, { type: 'play', requestId: 'request-a' });
    const ended = playbackReducer(playing, { type: 'end', requestId: 'request-a' });
    const replayed = playbackReducer(ended, { type: 'play', requestId: 'request-a' });
    expect(replayed).toMatchObject({ phase: 'playing', requestId: 'request-a', item: { id: ITEM.id } });
  });
});
