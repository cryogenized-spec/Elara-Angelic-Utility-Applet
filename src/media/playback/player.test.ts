// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../domain/media';
import type { PlaybackPlayerCallbacks, PlaybackPlayerSession } from './player';

const mocks = vi.hoisted(() => ({
  createYouTubePlayerSession: vi.fn(),
}));

vi.mock('../youtube/player', () => ({
  createYouTubePlayerSession: mocks.createYouTubePlayerSession,
}));

import { playbackPlayerPort } from './player';

const ITEM: MediaItem = {
  provider: 'youtube',
  id: 'a1B2c3D4e5F',
  kind: 'video',
  title: 'Phase 4 Track',
  channel: 'Player Channel',
  thumbnail: { url: 'https://i.ytimg.com/vi/a1B2c3D4e5F/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
  embedUrl: 'https://hostile.example/this-is-never-player-authority',
  apiDataFetchedAt: 1_800_000_000_000,
  intent: 'listen',
};

const callbacks: PlaybackPlayerCallbacks = {
  onReady: vi.fn(),
  onPlaying: vi.fn(),
  onPaused: vi.fn(),
  onEnded: vi.fn(),
  onError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  const session: PlaybackPlayerSession = { destroy: vi.fn() };
  mocks.createYouTubePlayerSession.mockResolvedValue(session);
});

describe('Phase 4 playback player port', () => {
  it('derives the provider player solely from canonical provider identity', async () => {
    const host = document.createElement('div');
    const controller = new AbortController();

    const session = await playbackPlayerPort.load(ITEM, host, controller.signal, callbacks);

    expect(session).toBeDefined();
    expect(mocks.createYouTubePlayerSession).toHaveBeenCalledTimes(1);
    expect(mocks.createYouTubePlayerSession).toHaveBeenCalledWith(
      ITEM.id,
      host,
      controller.signal,
      callbacks,
    );
    expect(JSON.stringify(mocks.createYouTubePlayerSession.mock.calls)).not.toContain('hostile.example');
  });

  it('fails closed before provider loading for a non-canonical persisted destination', async () => {
    const host = document.createElement('div');
    const controller = new AbortController();
    const hostile = { ...ITEM, webUrl: 'https://evil.example/watch?v=a1B2c3D4e5F' };

    await expect(playbackPlayerPort.load(hostile, host, controller.signal, callbacks))
      .rejects.toThrow('cannot be trusted');
    expect(mocks.createYouTubePlayerSession).not.toHaveBeenCalled();
  });

  it('does not load a provider after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(playbackPlayerPort.load(ITEM, document.createElement('div'), controller.signal, callbacks))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.createYouTubePlayerSession).not.toHaveBeenCalled();
  });
});
