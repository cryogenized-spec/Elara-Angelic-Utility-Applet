import { liveQuery } from 'dexie';
import { DEFAULT_CHAT_APPEARANCE, type MediaPlayerSurfacePreset } from '../../domain/preferences';
import { loadChatAppearance } from '../../persistence/preferences';

export const MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE = 'data-elara-media-player-preset';

/**
 * Project a presentation-only value onto the document root. PlaybackProvider
 * remains the playback authority; this attribute carries no lifecycle state.
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

/**
 * Keep the globally mounted player shell in sync with the existing durable
 * chat-appearance record. Dexie's live query is a derived projection only: it
 * introduces no second preference store and never enters playback state.
 */
export function installMediaPlayerSurfacePresetBinding(
  target: HTMLElement = document.documentElement,
): () => void {
  target.setAttribute(
    MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE,
    DEFAULT_CHAT_APPEARANCE.mediaPlayerSurfacePreset,
  );

  const subscription = liveQuery(() => loadChatAppearance()).subscribe({
    next: (appearance) => {
      target.setAttribute(MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE, appearance.mediaPlayerSurfacePreset);
    },
    error: () => {
      target.setAttribute(
        MEDIA_PLAYER_SURFACE_PRESET_ATTRIBUTE,
        DEFAULT_CHAT_APPEARANCE.mediaPlayerSurfacePreset,
      );
    },
  });

  return () => subscription.unsubscribe();
}
