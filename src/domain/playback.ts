import { isMediaItem, type MediaItem } from './media';

export const MEDIA_PLAYBACK_PREFERENCES = ['ask', 'embedded', 'external'] as const;
export type MediaPlaybackPreference = (typeof MEDIA_PLAYBACK_PREFERENCES)[number];
export const DEFAULT_MEDIA_PLAYBACK_PREFERENCE: MediaPlaybackPreference = 'ask';

export function isMediaPlaybackPreference(value: unknown): value is MediaPlaybackPreference {
  return typeof value === 'string' && (MEDIA_PLAYBACK_PREFERENCES as readonly string[]).includes(value);
}

export function normalizeMediaPlaybackPreference(value: unknown): MediaPlaybackPreference {
  return isMediaPlaybackPreference(value) ? value : DEFAULT_MEDIA_PLAYBACK_PREFERENCE;
}

export const PLAYBACK_PHASES = ['idle', 'requested', 'checking', 'ready', 'loading', 'playing', 'paused', 'ended', 'failed'] as const;
export type PlaybackPhase = (typeof PLAYBACK_PHASES)[number];

export interface PlaybackState {
  readonly phase: PlaybackPhase;
  readonly requestId: string | null;
  readonly item: MediaItem | null;
  readonly error: string | null;
}

export const INITIAL_PLAYBACK_STATE: PlaybackState = Object.freeze({
  phase: 'idle',
  requestId: null,
  item: null,
  error: null,
});

export type PlaybackEvent =
  | { readonly type: 'select'; readonly requestId: string; readonly item: MediaItem }
  | { readonly type: 'begin-check'; readonly requestId: string }
  | { readonly type: 'ready'; readonly requestId: string }
  | { readonly type: 'begin-load'; readonly requestId: string }
  | { readonly type: 'play'; readonly requestId: string }
  | { readonly type: 'pause'; readonly requestId: string }
  | { readonly type: 'end'; readonly requestId: string }
  | { readonly type: 'fail'; readonly requestId: string; readonly error: unknown }
  | { readonly type: 'reset' };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_PLAYBACK_ERROR_LENGTH = 320;

export function isPlaybackRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

function snapshotMediaItem(item: MediaItem): MediaItem {
  const thumbnail = item.thumbnail ? Object.freeze({ ...item.thumbnail }) : undefined;
  return Object.freeze({ ...item, ...(thumbnail ? { thumbnail } : {}) });
}

function boundedPlaybackError(value: unknown): string {
  if (typeof value !== 'string') return 'Playback failed.';
  const withoutControls = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  }).join('');
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  return (normalized || 'Playback failed.').slice(0, MAX_PLAYBACK_ERROR_LENGTH);
}

function ownsRequest(state: PlaybackState, requestId: string): boolean {
  return isPlaybackRequestId(requestId) && state.requestId === requestId && state.item !== null;
}

function transition(state: PlaybackState, phase: PlaybackPhase): PlaybackState {
  return Object.freeze({ ...state, phase, error: null });
}

/**
 * Deterministic application-owned playback lifecycle.
 *
 * Selection is the only event that may replace request lineage. Every later
 * event must carry the currently elected request id, so late callbacks from an
 * older readiness/player attempt cannot mutate a newer selection.
 */
export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  if (event.type === 'reset') return INITIAL_PLAYBACK_STATE;

  if (event.type === 'select') {
    if (!isPlaybackRequestId(event.requestId) || !isMediaItem(event.item)) return state;
    return Object.freeze({
      phase: 'requested',
      requestId: event.requestId,
      item: snapshotMediaItem(event.item),
      error: null,
    });
  }

  if (!ownsRequest(state, event.requestId)) return state;

  switch (event.type) {
    case 'begin-check':
      return state.phase === 'requested' ? transition(state, 'checking') : state;
    case 'ready':
      return state.phase === 'checking' ? transition(state, 'ready') : state;
    case 'begin-load':
      return state.phase === 'ready' || state.phase === 'ended' ? transition(state, 'loading') : state;
    case 'play':
      return state.phase === 'loading' || state.phase === 'paused' ? transition(state, 'playing') : state;
    case 'pause':
      return state.phase === 'playing' ? transition(state, 'paused') : state;
    case 'end':
      return state.phase === 'playing' || state.phase === 'paused' ? transition(state, 'ended') : state;
    case 'fail': {
      const failFrom: readonly PlaybackPhase[] = ['requested', 'checking', 'ready', 'loading', 'playing', 'paused'];
      if (!failFrom.includes(state.phase)) return state;
      return Object.freeze({ ...state, phase: 'failed', error: boundedPlaybackError(event.error) });
    }
  }
}
