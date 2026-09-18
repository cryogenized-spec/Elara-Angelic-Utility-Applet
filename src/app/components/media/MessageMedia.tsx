import { Fragment, lazy, Suspense } from 'react';
import type { MediaItem } from '../../../domain/media';
import './message-media.css';

/**
 * Lazy boundary for the media card.
 *
 * This component is the only media UI that ConversationSurface imports
 * statically. The real card and its stylesheet remain lazy; only the tiny rail
 * and reserved-shell stylesheet is eager so a slow module load cannot collapse
 * the conversation geometry to zero.
 */
const MediaCard = lazy(() => import('./MediaCard').then((module) => ({ default: module.MediaCard })));

function MediaRailSkeleton({ items }: { items: readonly MediaItem[] }) {
  return (
    <Fragment>
      {items.map((item) => (
        <div className="media-card__skeleton" aria-hidden="true" key={`skeleton:${item.provider}:${item.id}`}>
          <span className="media-card__skeleton-thumb" />
          <span className="media-card__skeleton-meta">
            <span className="media-card__skeleton-line media-card__skeleton-line--title" />
            <span className="media-card__skeleton-line media-card__skeleton-line--channel" />
          </span>
          <span className="media-card__skeleton-cta" />
        </div>
      ))}
    </Fragment>
  );
}

export function MessageMedia({ items }: { items?: readonly MediaItem[] }) {
  if (!items?.length) return null;
  return (
    <section className="media-rail" aria-label="Media results from YouTube">
      <Suspense fallback={<MediaRailSkeleton items={items} />}>
        {items.map((item) => (
          <MediaCard key={`${item.provider}:${item.id}`} item={item} />
        ))}
      </Suspense>
    </section>
  );
}
