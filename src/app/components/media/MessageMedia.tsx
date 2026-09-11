import { lazy, Suspense } from 'react';
import type { MediaItem } from '../../../domain/media';

/**
 * Lazy boundary for the media card.
 *
 * This component is the only media UI that ConversationSurface imports
 * statically, and it is a few lines. The card, its stylesheet, and the whole
 * `src/media` provider graph stay out of the initial bundle and load only when a
 * message actually carries resolved media.
 */
const MediaCard = lazy(() => import('./MediaCard').then((module) => ({ default: module.MediaCard })));

export function MessageMedia({ items }: { items?: readonly MediaItem[] }) {
  if (!items?.length) return null;
  return (
    <section className="media-rail" aria-label="Resolved YouTube results">
      <Suspense fallback={null}>
        {items.map((item) => (
          <MediaCard key={`${item.provider}:${item.id}`} item={item} />
        ))}
      </Suspense>
    </section>
  );
}
