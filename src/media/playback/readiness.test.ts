import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../../domain/media';
import { resetYouTubePlaybackReadinessCache } from '../youtube/readiness';
import { playbackReadinessPort } from './readiness';

const VIDEO_ID = 'a1B2c3D4e5F';
const NOW = 1_800_000_000_000;

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    provider: 'youtube',
    id: VIDEO_ID,
    kind: 'video',
    title: 'Readiness target',
    webUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    apiDataFetchedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => resetYouTubePlaybackReadinessCache());

describe('playback readiness port', () => {
  it('shares the external canonical identity boundary and rejects hostile stored web destinations before provider work', async () => {
    const result = await playbackReadinessPort.check(item({ webUrl: `https://evil.example/watch?v=${VIDEO_ID}` }), new AbortController().signal);
    expect(result).toMatchObject({ status: 'blocked', reason: 'invalid-target' });
  });

  it('derives internal identity without requiring a persisted iframe URL', () => {
    const media = item();
    expect(media).not.toHaveProperty('embedUrl');
    expect(media.provider).toBe('youtube');
    expect(media.kind).toBe('video');
    expect(media.id).toBe(VIDEO_ID);
  });

  it('blocks non-video media without loading provider readiness', async () => {
    const result = await playbackReadinessPort.check(item({
      kind: 'playlist',
      webUrl: `https://www.youtube.com/playlist?list=${VIDEO_ID}`,
    }), new AbortController().signal);
    expect(result).toMatchObject({ status: 'blocked', reason: 'unsupported' });
  });
});
