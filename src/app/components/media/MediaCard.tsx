import type { MediaItem } from '../../../domain/media';
import { mediaIntentOf } from '../../../domain/media';
import {
  detectHandoffPlatform,
  mediaDestinationUrl,
  mediaHandoffHref,
  mediaHandoffIntentHref,
  mediaHandoffLabel,
  type HandoffPlatform,
} from '../../../media/handoff';
import './media-card.css';

/**
 * One resolved media result.
 *
 * Deliberately a link, not a player. There is no iframe and no player script, so
 * the card costs an image and nothing else — and accidental audio is impossible by
 * construction rather than prevented by a flag someone can later flip. Tapping
 * hands the item to the platform (see `media/handoff`), so playback, the queue,
 * and background audio belong to whatever app the user already uses.
 *
 * The whole card is the control rather than a button inside it. A nested anchor
 * would be invalid HTML and a second tap target inside the first would only
 * create a way to hit the wrong one, so the action is *labelled* instead.
 *
 * The card states its provenance. A resolved video and a search-page fallback are
 * different claims, and only the first is ever rendered here.
 */
export function MediaCard({ item, platform }: {
  readonly item: MediaItem;
  readonly platform?: HandoffPlatform;
}) {
  const listen = mediaIntentOf(item) === 'listen';
  // One detector for both the label and the href: a card that promised music and
  // linked to the watch page would be worse than either.
  const resolved = platform ?? detectHandoffPlatform();
  const href = mediaHandoffHref(item, resolved);
  const destination = mediaDestinationUrl(item);
  const intentHref = mediaHandoffIntentHref(item, resolved);
  const label = mediaHandoffLabel(item);
  // A full phrase rather than a bare name, because the preposition is part of the
  // promise: on Android the tap leaves the browser for a chooser, and the user
  // should not discover that after the fact.
  const targetLabel = listen
    ? (resolved.isAndroid ? 'in your music app' : 'in YouTube Music')
    : 'on YouTube';

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (!resolved.isAndroid || !intentHref) return;
    // On Android Chrome, try the intent:// URI first to get the system chooser.
    // The href itself is always https, so if intent is not supported we have a
    // guaranteed fallback. We prevent the default https navigation and attempt
    // intent via location.href; if the intent cannot be handled, Chrome will
    // use S.browser_fallback_url to go to https, and our timeout provides a
    // second fallback for browsers that show ERR_UNKNOWN_URL_SCHEME instead.
    event.preventDefault();
    try {
      window.location.href = intentHref;
    } catch {
      window.open(destination, '_blank', 'noopener,noreferrer');
      return;
    }
    // Fallback for browsers that do not understand intent:// at all — they will
    // stay on the page and show ERR_UNKNOWN_URL_SCHEME if we do nothing. After a
    // short delay, if the page is still visible, open the https destination.
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        window.open(destination, '_blank', 'noopener,noreferrer');
      }
    }, 700);
  }

  return (
    <a
      className={`media-card media-card--${listen ? 'listen' : 'watch'}`}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open “${item.title}” ${targetLabel}`}
      data-intent-href={intentHref}
      onClick={handleClick}
    >
      <span className="media-card__thumb-wrap">
        {item.thumbnail ? (
          <img
            className="media-card__thumb"
            src={item.thumbnail.url}
            alt=""
            width={item.thumbnail.width}
            height={item.thumbnail.height}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="media-card__thumb media-card__thumb--empty" aria-hidden="true" />
        )}
        {/* No duration overlay: `search.list` does not return one, and fetching it
            would mean a second billed call per result (see the provider's quota
            rules). A `0:00` badge would be a fabricated number, which is worse
            than no number. */}
        <span className="media-card__badge" aria-hidden="true">YouTube</span>
      </span>
      <span className="media-card__meta">
        <span className="media-card__title">{item.title}</span>
        {item.channel ? <span className="media-card__channel">{item.channel}</span> : null}
      </span>
      <span className="media-card__cta">
        <span className="media-card__action">{label}</span>
        <span className="media-card__target" aria-hidden="true">↗</span>
      </span>
    </a>
  );
}
