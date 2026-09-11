import type { MediaItem } from '../../../domain/media';
import './media-card.css';

/**
 * One resolved media result.
 *
 * Deliberately a link, not a player. There is no iframe and no player script, so
 * the card costs an image and nothing else — and accidental audio is impossible
 * by construction rather than prevented by a flag someone can later flip.
 *
 * The card states its provenance. A resolved video and a search-page fallback are
 * different claims, and only the first is ever rendered here.
 */
export function MediaCard({ item }: { item: MediaItem }) {
  return (
    <a
      className="media-card"
      href={item.webUrl}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open “${item.title}” on YouTube`}
    >
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
      <span className="media-card__meta">
        <span className="media-card__title">{item.title}</span>
        {item.channel ? <span className="media-card__channel">{item.channel}</span> : null}
      </span>
      <span className="media-card__badge" aria-hidden="true">YouTube</span>
    </a>
  );
}
