import type { MediaPlaybackPreference } from '../../domain/playback';

export interface PlaybackRoutePresentation {
  readonly label: string;
  readonly description: string;
}

/**
 * Shared user-facing vocabulary for the three routes owned by PlaybackProvider.
 * This is presentation metadata only; it does not own routing state or behavior.
 */
export const MEDIA_PLAYBACK_ROUTE_PRESENTATION: Readonly<Record<MediaPlaybackPreference, PlaybackRoutePresentation>> = Object.freeze({
  ask: Object.freeze({
    label: 'Ask each time',
    description: 'Choose Play here or Open YouTube when you tap a media card.',
  }),
  embedded: Object.freeze({
    label: 'Play here',
    description: 'Route eligible cards through Elara’s single embedded YouTube player.',
  }),
  external: Object.freeze({
    label: 'Open YouTube',
    description: 'Keep media cards on the validated external YouTube handoff route.',
  }),
});

export const MEDIA_PLAYBACK_CHOOSER_LABEL = 'Choose playback';
export const MEDIA_PLAYBACK_EXTERNAL_FALLBACK_LABEL = 'Open YouTube instead';
