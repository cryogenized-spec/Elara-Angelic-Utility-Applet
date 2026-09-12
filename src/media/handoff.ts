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
 */
export function detectHandoffPlatform(): HandoffPlatform {
  if (typeof navigator === 'undefined') return { isAndroid: false };
  const hints = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  if (typeof hints?.platform === 'string' && hints.platform.trim()) {
    return { isAndroid: /android/i.test(hints.platform) };
  }
  return { isAndroid: /android/i.test(navigator.userAgent ?? '') };
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
 * The `href` a media card should use.
 *
 * Returns the destination URL unchanged on non-Android platforms and for any URL
 * that is not a well-formed https link, so the card is never given a value it
 * cannot navigate to.
 */
export function mediaHandoffHref(item: MediaItem, platform: HandoffPlatform = detectHandoffPlatform()): string {
  const destination = mediaDestinationUrl(item);
  const target = httpsUrl(destination);
  if (!platform.isAndroid || !target) return destination;

  const params = [
    `scheme=${target.protocol.replace(':', '')}`,
    // A fallback keeps an unresolved intent navigating rather than failing.
    `S.browser_fallback_url=${encodeURIComponent(target.toString())}`,
    'action=android.intent.action.VIEW',
    'category=android.intent.category.BROWSABLE',
  ];
  return `${ANDROID_INTENT_PREFIX}${target.host}${target.pathname}${target.search}#Intent;${params.join(';')};end`;
}

/** The label a card shows for its primary action. */
export function mediaHandoffLabel(item: MediaItem): string {
  return mediaIntentOf(item) === 'listen' ? 'Listen' : 'Watch';
}
