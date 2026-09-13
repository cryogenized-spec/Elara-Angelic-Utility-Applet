import type { MediaItem } from '../domain/media';
import { mediaIntentOf } from '../domain/media';

/**
 * Media hand-off.
 *
 * Elara never plays media. A tap hands the resolved item to the platform, which
 * owns playback: the user's player, their queue, background audio, picture in
 * picture, and hardware controls all come from there and cost this app nothing.
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

function httpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Canonical destination for a tap. Intent never rewrites provider identity or
 * swaps a YouTube result onto another YouTube surface.
 */
export function mediaDestinationUrl(item: MediaItem): string {
  return item.webUrl;
}

/**
 * The Android intent URI for a media item, if the platform can support it.
 *
 * Returns undefined on non-Android platforms or for non-https links, so callers
 * can fall back to the plain HTTPS destination. The intent form is attempted only
 * on Chromium-family Android browsers that support it.
 */
export function mediaHandoffIntentHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string | undefined {
  const destination = mediaDestinationUrl(item);
  const target = httpsUrl(destination);
  if (!platform.isAndroid || !target) return undefined;

  const params = [
    `scheme=${target.protocol.replace(':', '')}`,
    `S.browser_fallback_url=${encodeURIComponent(destination)}`,
    'action=android.intent.action.VIEW',
    'category=android.intent.category.BROWSABLE',
  ];
  return `${ANDROID_INTENT_PREFIX}${target.host}${target.pathname}${target.search}#Intent;${params.join(';')};end`;
}

/**
 * The `href` a media card should use.
 *
 * Always returns the provider's canonical destination. Android intent handling is
 * separate and therefore cannot turn the ordinary href into a dead custom URL.
 */
export function mediaHandoffHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string {
  void platform;
  return mediaDestinationUrl(item);
}

/** The label a card shows for its primary action. */
export function mediaHandoffLabel(item: MediaItem): string {
  return mediaIntentOf(item) === 'listen' ? 'Listen' : 'Watch';
}
