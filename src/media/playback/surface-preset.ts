import type { MediaPlayerSurfacePreset } from '../../domain/preferences';

export const MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE = 'data-elara-media-player-preset';

/**
 * Project the existing durable appearance preference onto the document root so
 * the globally mounted player host can consume presentation-only CSS without
 * learning about persistence or owning another preference state.
 */
export function bindMediaPlayerSurfacePreset(
  target: HTMLElement,
  preset: MediaPlayerSurfacePreset,
): () => void {
  target.setAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE, preset);
  return () => {
    if (target.getAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE) === preset) {
      target.removeAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE);
    }
  };
}
