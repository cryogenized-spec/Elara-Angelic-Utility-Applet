import type { MediaItem } from '../domain/media';
import { mediaIntentOf } from '../domain/media';

/**
 * Media hand-off.
 *
 * Elara never plays media. A tap hands the resolved item to the platform, which
 * owns playback: the user's player, their queue, background audio, picture in
 * picture, and hardware controls all come from there and cost this app nothing.
 * An embedded player would import roughly a megabyte of provider code to deliver
 * a worse version of all of that, and would trap audio inside a chat window.
 *
 * Two targets exist because the platforms differ in what "pick my player" means:
 *
 * - **Android** gets an `intent://` URI. This is the only mechanism a web app has
 *   for asking Android to resolve a media link across *all* installed handlers
 *   rather than jumping to whichever one registered the plain https link. With
 *   more than one candidate the system shows its own picker, which is exactly the
 *   behaviour wanted for "choose my music player". `S.browser_fallback_url`
 *   carries the canonical web URL so an unrecognised scheme degrades to the
 *   browser instead of doing nothing.
 * - **Everything else** gets the canonical web URL verbatim. `intent://` is not a
 *   scheme other platforms understand, and inventing per-platform deep links for
 *   players Elara cannot detect would be guessing.
 *
 * The `listen` intent additionally prefers the platform's music surface, because
 * a music video's watch page is a poor thing to hand to an audio player.
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
 *
 * Correction (2026-09-12): The previous implementation treated any Android UA as
 * intent-capable, but Firefox on Android and PWA standalone contexts do not
 * understand `intent://` and show ERR_UNKNOWN_URL_SCHEME. We now only report
 * Android when the UA also indicates a Chromium-based browser that is known to
 * support intent (Chrome, Samsung Internet), and the href itself is always https
 * — intent is attempted only via a user-gesture navigation with https as the
 * guaranteed fallback.
 */
export function detectHandoffPlatform(): HandoffPlatform {
  if (typeof navigator === 'undefined') return { isAndroid: false };
  const nav = navigator as unknown as {
    userAgent?: string;
    userAgentData?: { platform?: string; brands?: Array<{ brand: string }> };
  };
  const hints = nav.userAgentData;
  const ua = nav.userAgent ?? '';

  // Prefer client hints when available.
  if (typeof hints?.platform === 'string' && hints.platform.trim()) {
    const isAndroidPlatform = /android/i.test(hints.platform);
    if (!isAndroidPlatform) return { isAndroid: false };
    // If brands are available, require a Chromium brand for intent support.
    if (Array.isArray(hints.brands) && hints.brands.length > 0) {
      const brandString = hints.brands.map((b) => b.brand).join(' ');
      const isChromium = /Chrom(ium|e)|SamsungBrowser|Google Chrome/i.test(brandString);
      const isFirefox = /Firefox/i.test(ua);
      return { isAndroid: isChromium && !isFirefox };
    }
    // No brands, but platform says Android — check UA for Chrome.
    const isChrome = /Chrome|CriOS|SamsungBrowser/i.test(ua);
    const isFirefox = /Firefox|FxiOS/i.test(ua);
    const isEdge = /Edg/i.test(ua);
    return { isAndroid: isChrome && !isFirefox && !isEdge };
  }

  // Fallback to UA string.
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
 * The music-appropriate destination for a YouTube video.
 *
 * Only a single video gets redirected: a playlist, a channel, or any URL with a
 * path shape Elara does not recognise is handed through untouched rather than
 * rewritten into something plausible but wrong.
 */
function musicDestination(item: MediaItem, webUrl: URL): string {
  if (item.kind !== 'video') return webUrl.toString();
  if (webUrl.hostname !== 'www.youtube.com') return webUrl.toString();
  if (webUrl.pathname !== '/watch') return webUrl.toString();
  const videoId = webUrl.searchParams.get('v');
  if (!videoId) return webUrl.toString();
  // Preserve a start offset: "play this song from 0:42" must survive hand-off.
  const start = webUrl.searchParams.get('t');
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}${start ? `&t=${encodeURIComponent(start)}` : ''}`;
}

/** The canonical destination for a tap, before any platform hand-off encoding. */
export function mediaDestinationUrl(item: MediaItem): string {
  const web = httpsUrl(item.webUrl);
  if (!web) return item.webUrl;
  if (mediaIntentOf(item) !== 'listen') return web.toString();
  return musicDestination(item, web);
}

/**
 * The Android intent URI for a media item, if the platform can support it.
 *
 * Returns undefined on non-Android platforms or for non-https links, so callers
 * can fall back to the plain https destination. The intent form is what makes
 * Android show its app chooser (all handlers) rather than jumping to the default
 * browser, but it is only understood by Chrome on Android — other browsers show
 * ERR_UNKNOWN_URL_SCHEME.
 */
export function mediaHandoffIntentHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string | undefined {
  const destination = mediaDestinationUrl(item);
  const target = httpsUrl(destination);
  if (!platform.isAndroid || !target) return undefined;

  const params = [
    `scheme=${target.protocol.replace(':', '')}`,
    // A fallback keeps an unresolved intent navigating rather than failing.
    `S.browser_fallback_url=${encodeURIComponent(target.toString())}`,
    'action=android.intent.action.VIEW',
    'category=android.intent.category.BROWSABLE',
  ];
  return `${ANDROID_INTENT_PREFIX}${target.host}${target.pathname}${target.search}#Intent;${params.join(';')};end`;
}

/**
 * The `href` a media card should use.
 *
 * Always returns the https destination. The intent URI is available separately
 * via `mediaHandoffIntentHref` and is attempted via a user-gesture navigation
 * on Android, with the https URL as the guaranteed fallback. This avoids
 * ERR_UNKNOWN_URL_SCHEME on desktop, in Firefox on Android, and in PWA
 * standalone contexts where intent:// is not recognised, while still allowing
 * the chooser on Chrome for Android.
 */
export function mediaHandoffHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string {
  const destination = mediaDestinationUrl(item);
  // The href is always the https destination — never an intent:// URI — so the
  // link is never dead. Android intent handling is done in the click handler.
  void platform;
  return destination;
}

/** The label a card shows for its primary action. */
export function mediaHandoffLabel(item: MediaItem): string {
  return mediaIntentOf(item) === 'listen' ? 'Listen' : 'Watch';
}
