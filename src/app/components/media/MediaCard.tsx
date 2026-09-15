import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { MediaItem } from '../../../domain/media';
import { mediaIntentOf } from '../../../domain/media';
import type { PlaybackPhase } from '../../../domain/playback';
import { usePlaybackAuthority } from '../../../media/playback/PlaybackProvider';
import {
  MEDIA_PLAYBACK_CHOOSER_LABEL,
  MEDIA_PLAYBACK_EXTERNAL_FALLBACK_LABEL,
  MEDIA_PLAYBACK_ROUTE_PRESENTATION,
} from '../../../media/playback/presentation';
import {
  detectHandoffPlatform,
  mediaDestinationUrl,
  mediaHandoffHref,
  mediaHandoffIntentHref,
  mediaHandoffLabel,
  type HandoffPlatform,
} from '../../../media/handoff';
import './media-card.css';

const YOUTUBE_BRAND_LOGO_URL = 'https://www.gstatic.com/youtube/img/branding/youtubelogo/svg/youtubelogo.svg';

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

function YouTubeBrandVisual() {
  return (
    <span className="media-card__brand">
      <span className="media-card__brand-label"><span>Source</span><span>: YouTube</span></span>
      <span className="media-card__brand-logo-frame">
        <img className="media-card__brand-logo" src={YOUTUBE_BRAND_LOGO_URL} alt="YouTube" />
      </span>
    </span>
  );
}

function MediaCardBody({ item, action, unavailable = false, target, showTextSource = false }: {
  readonly item: MediaItem;
  readonly action: string;
  readonly unavailable?: boolean;
  readonly target?: string;
  readonly showTextSource?: boolean;
}) {
  return <>
    <span className="media-card__thumb-wrap">
      <MediaThumbnail key={item.thumbnail?.url ?? 'no-thumbnail'} thumbnail={item.thumbnail} />
    </span>
    <span className="media-card__meta">
      {showTextSource ? <span className="media-card__source">Source: YouTube</span> : null}
      <span className="media-card__title">{item.title}</span>
      {item.channel ? <span className="media-card__channel">{item.channel}</span> : null}
    </span>
    <span className="media-card__cta">
      <span className="media-card__action">{unavailable ? 'Unavailable' : action}</span>
      {!unavailable && target ? <span className="media-card__target" aria-hidden="true">{target}</span> : null}
    </span>
  </>;
}

function playbackStatusLabel(phase: PlaybackPhase): string | null {
  if (phase === 'requested' || phase === 'checking' || phase === 'ready') return 'Checking playback…';
  if (phase === 'loading') return 'Loading player…';
  if (phase === 'paused') return 'Player ready';
  if (phase === 'playing') return 'Playing here';
  if (phase === 'ended') return 'Playback ended';
  return null;
}

/**
 * One resolved media result routed through the singular playback authority.
 *
 * The MediaItem remains one representation regardless of destination. `external`
 * preserves the canonical handoff; `embedded` calls PlaybackProvider.start();
 * `ask` is disclosure-only UI between those same routes. The card never owns
 * readiness, player lifecycle, request lineage, or durable preference state.
 */
export function MediaCard({ item, platform }: {
  readonly item: MediaItem;
  readonly platform?: HandoffPlatform;
}) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserToken = useId();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const playback = usePlaybackAuthority();
  const listen = mediaIntentOf(item) === 'listen';
  const resolved = platform ?? detectHandoffPlatform();
  const href = mediaHandoffHref(item, resolved);
  const destination = mediaDestinationUrl(item);
  const intentHref = mediaHandoffIntentHref(item, resolved);
  const label = mediaHandoffLabel(item);
  // PlaybackProvider initializes to `ask`, so initial-load failure is already
  // safe. During a save, preference remains the last durable value until the
  // write succeeds; routing must not temporarily invent a different choice.
  const route = playback.preference;
  const ownsPlayback = playback.state.item?.provider === item.provider && playback.state.item.id === item.id;
  const statusLabel = ownsPlayback ? playbackStatusLabel(playback.state.phase) : null;
  const internalBusy = ownsPlayback && (
    playback.state.phase === 'requested'
    || playback.state.phase === 'checking'
    || playback.state.phase === 'ready'
    || playback.state.phase === 'loading'
    || playback.state.phase === 'paused'
    || playback.state.phase === 'playing'
    || playback.state.phase === 'ended'
  );
  const chooserId = `media-playback-${chooserToken.replace(/:/g, '')}`;

  if (!href || !destination) {
    return (
      <article
        className={`media-card media-card--${listen ? 'listen' : 'watch'} media-card--unavailable`}
        aria-label={`Unavailable YouTube result: ${item.title}`}
      >
        <MediaCardBody item={item} action={label} unavailable showTextSource />
      </article>
    );
  }

  function handleExternalClick(event: MouseEvent<HTMLAnchorElement>): void {
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

  function startEmbedded(): void {
    setChooserOpen(false);
    void playback.start(item).catch(() => undefined);
  }

  function handleRoutedKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape' || route !== 'ask' || !chooserOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setChooserOpen(false);
    primaryRef.current?.focus();
  }

  const externalLink = (className: string, text: string) => (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-intent-href={intentHref}
      onClick={handleExternalClick}
    >
      {text}
    </a>
  );

  if (route === 'external') {
    return (
      <a
        className={`media-card media-card--${listen ? 'listen' : 'watch'}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={`Open “${item.title}” on YouTube`}
        data-intent-href={intentHref}
        onClick={handleExternalClick}
      >
        <YouTubeBrandVisual />
        <MediaCardBody item={item} action={label} target="↗" />
      </a>
    );
  }

  const failed = ownsPlayback && playback.state.phase === 'failed' && playback.state.error;

  return (
    <article
      className={`media-card media-card--${listen ? 'listen' : 'watch'} media-card--routed`}
      onKeyDown={handleRoutedKeyDown}
    >
      <a
        className="media-card__brand-link"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`Open “${item.title}” on YouTube`}
        data-intent-href={intentHref}
        onClick={handleExternalClick}
      >
        <YouTubeBrandVisual />
      </a>

      <button
        ref={primaryRef}
        className="media-card__primary"
        type="button"
        disabled={route === 'embedded' && internalBusy}
        aria-expanded={route === 'ask' ? chooserOpen : undefined}
        aria-controls={route === 'ask' ? chooserId : undefined}
        onClick={route === 'embedded' ? startEmbedded : () => setChooserOpen((open) => !open)}
      >
        <MediaCardBody
          item={item}
          action={statusLabel ?? (route === 'embedded'
            ? MEDIA_PLAYBACK_ROUTE_PRESENTATION.embedded.label
            : MEDIA_PLAYBACK_CHOOSER_LABEL)}
          target={route === 'ask' ? '›' : undefined}
        />
      </button>

      {route === 'ask' && chooserOpen ? (
        <div className="media-card__chooser" id={chooserId} role="group" aria-label={`Choose how to play ${item.title}`}>
          <button
            type="button"
            className="media-card__choice"
            disabled={internalBusy}
            onClick={startEmbedded}
          >
            {MEDIA_PLAYBACK_ROUTE_PRESENTATION.embedded.label}
          </button>
          {externalLink('media-card__choice media-card__choice--external', MEDIA_PLAYBACK_ROUTE_PRESENTATION.external.label)}
        </div>
      ) : null}

      {failed ? (
        <div className="media-card__failure" role="status">
          <span>{playback.state.error}</span>
          {externalLink('media-card__fallback', MEDIA_PLAYBACK_EXTERNAL_FALLBACK_LABEL)}
        </div>
      ) : null}
    </article>
  );
}
