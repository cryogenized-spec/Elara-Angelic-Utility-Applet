import type { MediaItem } from '../../domain/media';
import type { PlaybackReadinessDecision } from '../../domain/playback';
import { mediaDestinationUrl } from '../handoff';

export interface PlaybackReadinessPort {
  check(item: MediaItem, signal: AbortSignal): Promise<PlaybackReadinessDecision>;
}

/**
 * Resolve internal-play readiness without creating a second playback authority.
 *
 * The PlaybackProvider remains the only owner of request lineage and lifecycle.
 * This port is deliberately stateless: it validates the selected target and
 * delegates provider-specific eligibility work lazily. The persisted embedUrl
 * is never consulted; internal playback is derived from provider + validated id.
 */
export const playbackReadinessPort: PlaybackReadinessPort = Object.freeze({
  async check(item, signal) {
    if (signal.aborted) return { status: 'aborted' };

    if (item.provider !== 'youtube' || item.kind !== 'video') {
      return Object.freeze({
        status: 'blocked' as const,
        reason: 'unsupported' as const,
        message: 'This media type is not supported for internal playback.',
      });
    }

    // External and internal paths share the same canonical identity boundary.
    // A corrupted/hostile persisted webUrl cannot become a more privileged
    // internal player target merely because provider + id happen to look valid.
    if (!mediaDestinationUrl(item)) {
      return Object.freeze({
        status: 'blocked' as const,
        reason: 'invalid-target' as const,
        message: 'This media result cannot be trusted for internal playback.',
      });
    }

    const { checkYouTubePlaybackReadiness } = await import('../youtube/readiness');
    return checkYouTubePlaybackReadiness(item.id, signal);
  },
});
