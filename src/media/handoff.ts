import type { MediaItem } from '../domain/media';
import { mediaIntentOf } from '../domain/media';

/**
 * Validated external media hand-off.
 *
 * This module owns only the external route. Internal playback, when selected,
 * remains owned by the singular PlaybackProvider/player path. An external tap
 * hands the resolved item to the platform, which then owns playback, queue,
 * background audio, picture-in-picture and hardware controls.
 *
 * The provider result's canonical HTTPS destination is preserved for both
 * `watch` and `listen`. Intent changes the human action label, not the YouTube
 * URL. This avoids inventing a cross-surface music.youtube.com destination that
 * was not returned by the search integration.
 *
 * Two targets exist because the platforms differ in what "pick my player" means:
 *
 * - **Android Chromium** may get an `intent://` attempt from a user gesture. The
 *   intent carries the exact canonical HTTPS URL as its browser fallback and is
 *   not pinned to a package, leaving handler choice to Android.
 * - **Everything else** gets the canonical web URL verbatim. `intent://` is not a
 *   scheme other platforms understand, and inventing per-platform deep links for
 *   players Elara cannot detect would be guessing.
 *
 * Stored media is external/corruptible input. A card may navigate only when its
 * URL exactly matches the canonical destination that this provider+kind+id would
 * have produced. A merely-HTTPS hostile host is not sufficient.
 */

/** Recognised Android hand-off target. Kept module-private on purpose. */
const ANDROID_INTENT_PREFIX = 'intent://';

export interface HandoffPlatform {
  readonly isAndroid: boolean;
}

/**
 * Detects Android from the client-hints platform brand when available, falling
 * back to the UA string. Both are read defensively: this runs during render and a
 * missing value must mean "use the plain web link", never an exception.
 */
export function detectHandoffPlatform(): HandoffPlatform {
  if (typeof navigator === 'undefined') return { isAndroid: false };
  const nav = navigator as unknown as {
    userAgent?: string;
    userAgentData?: { platform?: string; brands?: Array<{ brand: string }> };
  };
  const hints = nav.userAgentData;
  const ua = nav.userAgent ?? '';

  if (typeof hints?.platform === 'string' && hints.platform.trim()) {
    const isAndroidPlatform = /android/i.test(hints.platform);
    if (!isAndroidPlatform) return { isAndroid: false };
    if (Array.isArray(hints.brands) && hints.brands.length > 0) {
      const brandString = hints.brands.map((b) => b.brand).join(' ');
      const isChromium = /Chrom(ium|e)|SamsungBrowser|Google Chrome/i.test(brandString);
      const isFirefox = /Firefox/i.test(ua);
      return { isAndroid: isChromium && !isFirefox };
    }
    const isChrome = /Chrome|CriOS|SamsungBrowser/i.test(ua);
    const isFirefox = /Firefox|FxiOS/i.test(ua);
    const isEdge = /Edg/i.test(ua);
    return { isAndroid: isChrome && !isFirefox && !isEdge };
  }

  const isAndroid = /Android/i.test(ua);
  if (!isAndroid) return { isAndroid: false };
  const isChrome = /Chrome|CriOS|SamsungBrowser/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isEdge = /Edg/i.test(ua);
  const isOpera = /OPR|Opera/i.test(ua);
  return { isAndroid: isChrome && !isFirefox && !isEdge && !isOpera };
}

/** Canonical URL Elara's YouTube adapter is allowed to produce. */
export function canonicalMediaWebUrl(item: Pick<MediaItem, 'provider' | 'kind' | 'id'>): string | undefined {
  if (item.provider !== 'youtube' || !item.id || item.id.length > 128 || item.id.trim() !== item.id || /\s/.test(item.id)) return undefined;
  if (item.kind === 'video') return `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;
  if (item.kind === 'playlist') return `https://www.youtube.com/playlist?list=${encodeURIComponent(item.id)}`;
  return undefined;
}

/**
 * Canonical destination for a tap. Returns undefined rather than repairing,
 * redirecting or normalising an untrusted stored URL.
 */
export function mediaDestinationUrl(item: MediaItem): string | undefined {
  const expected = canonicalMediaWebUrl(item);
  return expected && item.webUrl === expected ? expected : undefined;
}

/**
 * The Android intent URI for a media item, if the platform and destination are
 * both safe. A rejected ordinary destination can never be wrapped in a more
 * privileged launch URI.
 */
export function mediaHandoffIntentHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string | undefined {
  const destination = mediaDestinationUrl(item);
  if (!platform.isAndroid || !destination) return undefined;
  const target = new URL(destination);

  const params = [
    `scheme=${target.protocol.replace(':', '')}`,
    `S.browser_fallback_url=${encodeURIComponent(destination)}`,
    'action=android.intent.action.VIEW',
    'category=android.intent.category.BROWSABLE',
  ];
  return `${ANDROID_INTENT_PREFIX}${target.host}${target.pathname}${target.search}#Intent;${params.join(';')};end`;
}

/**
 * The `href` a media card should use. Invalid, non-canonical or hostile URLs do
 * not get an href at all; callers render a non-interactive unavailable card.
 */
export function mediaHandoffHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string | undefined {
  void platform;
  return mediaDestinationUrl(item);
}

/** The label a card shows for its primary action. */
export function mediaHandoffLabel(item: MediaItem): string {
  return mediaIntentOf(item) === 'listen' ? 'Listen' : 'Watch';
}
