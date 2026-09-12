import type { MediaItem } from '../../../domain/media';
import { mediaIntentOf } from '../../../domain/media';
import { detectHandoffPlatform, mediaHandoffHref, mediaHandoffLabel, type HandoffPlatform } from '../../../media/handoff';
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
  const label = mediaHandoffLabel(item);
  // A full phrase rather than a bare name, because the preposition is part of the
  // promise: on Android the tap leaves the browser for a chooser, and the user
  // should not discover that after the fact.
  const destination = listen
    ? (resolved.isAndroid ? 'in your music app' : 'in YouTube Music')
    : 'on YouTube';

  return (
    <a
      className={`media-card media-card--${listen ? 'listen' : 'watch'}`}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open “${item.title}” ${destination}`}
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
