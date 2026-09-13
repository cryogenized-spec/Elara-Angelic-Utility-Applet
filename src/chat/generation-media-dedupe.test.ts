import { describe, expect, it } from 'vitest';
import type { MediaIntent, MediaItem } from '../domain/media';
import { applyGenerationEvent, createGenerationState } from './generation-state';

function video(id: string, intent?: MediaIntent, title = `Video ${id}`): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title,
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
    ...(intent ? { intent } : {}),
  };
}

describe('generation media identity', () => {
  it('deduplicates identities inside one incoming batch and keeps the last valid representation', () => {
    const state = applyGenerationEvent(createGenerationState('gen-1', { startedAt: 0 }), {
      generationId: 'gen-1',
      receivedAt: 10,
      event: {
        type: 'media-resolved',
        provider: 'youtube',
        queries: ['same video twice'],
        items: [
          video('same', 'watch', 'First metadata'),
          video('same', 'listen', 'Latest metadata'),
        ],
      },
    });

    expect(state.mediaItems).toEqual([video('same', 'listen', 'Latest metadata')]);
  });

  it('updates an existing identity in place when a later event changes its intent', () => {
    let state = createGenerationState('gen-2', { startedAt: 0 });
    state = applyGenerationEvent(state, {
      generationId: 'gen-2', receivedAt: 10,
      event: { type: 'media-resolved', provider: 'youtube', queries: ['a'], items: [video('a', 'watch'), video('b', 'watch')] },
    });
    state = applyGenerationEvent(state, {
      generationId: 'gen-2', receivedAt: 20,
      event: { type: 'media-resolved', provider: 'youtube', queries: ['b again'], items: [video('b', 'listen', 'B refreshed'), video('c', 'watch')] },
    });

    expect(state.mediaItems.map((item) => `${item.id}:${item.intent ?? 'watch'}:${item.title}`)).toEqual([
      'a:watch:Video a',
      'b:listen:B refreshed',
      'c:watch:Video c',
    ]);
  });

  it('allows a later default/watch representation to replace an earlier listen representation', () => {
    let state = createGenerationState('gen-3', { startedAt: 0 });
    state = applyGenerationEvent(state, {
      generationId: 'gen-3', receivedAt: 10,
      event: { type: 'media-resolved', provider: 'youtube', queries: ['track'], items: [video('track', 'listen')] },
    });
    state = applyGenerationEvent(state, {
      generationId: 'gen-3', receivedAt: 20,
      event: { type: 'media-resolved', provider: 'youtube', queries: ['track'], items: [video('track')] },
    });

    expect(state.mediaItems).toEqual([video('track')]);
  });
});
