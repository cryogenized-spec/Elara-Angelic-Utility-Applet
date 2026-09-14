import type { MediaItem } from '../../domain/media';
import { mediaDestinationUrl } from '../handoff';

export interface PlaybackPlayerCallbacks {
  onReady(): void;
  onPlaying(): void;
  onPaused(): void;
  onEnded(): void;
  onError(message: string): void;
}

export interface PlaybackPlayerSession {
  destroy(): void;
}

export interface PlaybackPlayerPort {
  load(
    item: MediaItem,
    host: HTMLElement,
    signal: AbortSignal,
    callbacks: PlaybackPlayerCallbacks,
  ): Promise<PlaybackPlayerSession>;
}

function aborted(): DOMException {
  return new DOMException('Playback was cancelled.', 'AbortError');
}

/**
 * Thin provider-neutral player seam. PlaybackProvider remains the lifecycle
 * authority; this port only turns one already-approved MediaItem into one
 * provider player session.
 */
export const playbackPlayerPort: PlaybackPlayerPort = Object.freeze({
  async load(item, host, signal, callbacks): Promise<PlaybackPlayerSession> {
    if (signal.aborted) throw aborted();
    if (item.provider !== 'youtube' || item.kind !== 'video' || !mediaDestinationUrl(item)) {
      throw new Error('This media result cannot be trusted for internal playback.');
    }

    // Persisted embedUrl is intentionally ignored. The provider target is
    // reconstructed only from the already validated provider identity.
    const videoId = item.id;
    const { createYouTubePlayerSession } = await import('../youtube/player');
    if (signal.aborted) throw aborted();
    return createYouTubePlayerSession(videoId, host, signal, callbacks);
  },
});
