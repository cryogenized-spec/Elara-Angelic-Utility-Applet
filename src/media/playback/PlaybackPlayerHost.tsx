import { useEffect, useRef } from 'react';
import type { PlaybackState } from '../../domain/playback';
import type { PlaybackPlayerPort, PlaybackPlayerSession } from './player';
import './player-host.css';

interface ActivePlayerAttempt {
  readonly requestId: string;
  readonly controller: AbortController;
  session: PlaybackPlayerSession | null;
}

function disposeAttempt(attempt: ActivePlayerAttempt): void {
  attempt.controller.abort();
  attempt.session?.destroy();
}

export function PlaybackPlayerHost({
  state,
  playerPort,
  markPlaying,
  markPaused,
  markEnded,
  markFailed,
}: {
  readonly state: PlaybackState;
  readonly playerPort: PlaybackPlayerPort;
  readonly markPlaying: (requestId: string) => void;
  readonly markPaused: (requestId: string) => void;
  readonly markEnded: (requestId: string) => void;
  readonly markFailed: (requestId: string, error: unknown) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<ActivePlayerAttempt | null>(null);

  // A new elected request owns the one player lane. Old provider callbacks may
  // still arrive, but their request id cannot mutate the newer reducer state.
  useEffect(() => {
    const active = activeRef.current;
    if (!active) return;
    const requestChanged = state.requestId !== active.requestId;
    const phaseOwnsNoPlayer = state.phase === 'idle'
      || state.phase === 'requested'
      || state.phase === 'checking'
      || state.phase === 'ready'
      || state.phase === 'failed';
    if (!requestChanged && !phaseOwnsNoPlayer) return;
    activeRef.current = null;
    disposeAttempt(active);
  }, [state.phase, state.requestId]);

  // `loading` is elected only by PlaybackProvider.start()/beginLoad(). The host
  // never selects media or invents request lineage; it materializes the player
  // for the request the existing reducer has already accepted.
  useEffect(() => {
    if (state.phase !== 'loading' || !state.requestId || !state.item) return;
    if (activeRef.current?.requestId === state.requestId) return;
    const host = hostRef.current;
    if (!host) {
      markFailed(state.requestId, 'The embedded player surface is unavailable.');
      return;
    }

    const requestId = state.requestId;
    const controller = new AbortController();
    const attempt: ActivePlayerAttempt = { requestId, controller, session: null };
    activeRef.current = attempt;

    void playerPort.load(state.item, host, controller.signal, {
      onReady: () => markPaused(requestId),
      onPlaying: () => markPlaying(requestId),
      onPaused: () => markPaused(requestId),
      onEnded: () => markEnded(requestId),
      onError: (message) => markFailed(requestId, message),
    }).then((session) => {
      if (activeRef.current !== attempt || controller.signal.aborted) {
        session.destroy();
        return;
      }
      attempt.session = session;
    }).catch(() => {
      if (activeRef.current !== attempt || controller.signal.aborted) return;
      activeRef.current = null;
      host.replaceChildren();
      markFailed(requestId, 'The embedded YouTube player could not be loaded.');
    });
  }, [markEnded, markFailed, markPaused, markPlaying, playerPort, state.item, state.phase, state.requestId]);

  useEffect(() => () => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active) disposeAttempt(active);
  }, []);

  const visible = state.phase === 'loading'
    || state.phase === 'playing'
    || state.phase === 'paused'
    || state.phase === 'ended';

  return (
    <section
      className="playback-player-surface"
      data-playback-phase={state.phase}
      data-playback-request-id={state.requestId ?? ''}
      aria-label="YouTube player"
      hidden={!visible}
    >
      <div ref={hostRef} className="playback-player-host" />
    </section>
  );
}
