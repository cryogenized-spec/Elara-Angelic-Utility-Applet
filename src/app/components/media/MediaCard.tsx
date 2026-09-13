import { useState } from 'react';
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

function MediaThumbnail({ thumbnail }: { thumbnail: MediaItem['thumbnail'] }) {
  const [failed, setFailed] = useState(false);

  if (!thumbnail || failed) {
    return <span className="media-card__thumb media-card__thumb--empty" aria-hidden="true" />;
  }

  return (
    <img
      className="media-card__thumb"
      src={thumbnail.url}
      alt=""
      width={thumbnail.width}
      height={thumbnail.height}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function MediaCardBody({ item, action, unavailable = false }: {
  readonly item: MediaItem;
  readonly action: string;
  readonly unavailable?: boolean;
}) {
  return <>
    <span className="media-card__thumb-wrap">
      <MediaThumbnail key={item.thumbnail?.url ?? 'no-thumbnail'} thumbnail={item.thumbnail} />
      {/* Search cards display only metadata returned by the provider. */}
      <span className="media-card__badge">YouTube</span>
    </span>
    <span className="media-card__meta">
      <span className="media-card__title">{item.title}</span>
      {item.channel ? <span className="media-card__channel">{item.channel}</span> : null}
    </span>
    <span className="media-card__cta">
      <span className="media-card__action">{unavailable ? 'Unavailable' : action}</span>
      {!unavailable && <span className="media-card__target" aria-hidden="true">↗</span>}
    </span>
  </>;
}

/**
 * One resolved media result.
 *
 * Deliberately a link, not a player. There is no iframe and no player script, so
 * the card costs an image and nothing else — and accidental audio is impossible by
 * construction rather than prevented by a flag someone can later flip.
 *
 * The whole settled card is the control rather than a button inside it. Unsafe or
 * corrupted stored destinations are rendered as inert cards with no anchor/href;
 * the UI never repairs an external URL into something that merely looks plausible.
 *
 * The visible YouTube trade name identifies the API-data source without drawing,
 * recolouring or otherwise manufacturing a YouTube logo asset. On valid results
 * the whole attributed card links to the canonical YouTube content.
 */
export function MediaCard({ item, platform }: {
  readonly item: MediaItem;
  readonly platform?: HandoffPlatform;
}) {
  const listen = mediaIntentOf(item) === 'listen';
  const resolved = platform ?? detectHandoffPlatform();
  const href = mediaHandoffHref(item, resolved);
  const destination = mediaDestinationUrl(item);
  const intentHref = mediaHandoffIntentHref(item, resolved);
  const label = mediaHandoffLabel(item);

  if (!href || !destination) {
    return (
      <article
        className={`media-card media-card--${listen ? 'listen' : 'watch'} media-card--unavailable`}
        aria-label={`Unavailable YouTube result: ${item.title}`}
      >
        <MediaCardBody item={item} action={label} unavailable />
      </article>
    );
  }

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (!resolved.isAndroid || !intentHref) return;
    event.preventDefault();
    try {
      window.location.href = intentHref;
    } catch {
      window.open(destination, '_blank', 'noopener,noreferrer');
      return;
    }
    // If the browser stayed visible after the Android intent attempt, preserve a
    // safe path to the exact same canonical HTTPS destination.
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
      title={`Open “${item.title}” on YouTube`}
      data-intent-href={intentHref}
      onClick={handleClick}
    >
      <MediaCardBody item={item} action={label} />
    </a>
  );
}
