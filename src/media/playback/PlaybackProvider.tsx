import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isFreshMediaItem, type MediaItem } from '../../domain/media';
import {
  DEFAULT_MEDIA_PLAYBACK_PREFERENCE,
  INITIAL_PLAYBACK_STATE,
  isPlaybackRequestId,
  normalizeMediaPlaybackPreference,
  playbackReducer,
  type MediaPlaybackPreference,
  type PlaybackState,
} from '../../domain/playback';
import { loadMediaPlaybackPreference, saveMediaPlaybackPreference } from '../../persistence/preferences';

export type PlaybackPreferenceStatus = 'loading' | 'ready' | 'failed';

export interface PlaybackPreferenceStore {
  load(): Promise<MediaPlaybackPreference>;
  save(value: MediaPlaybackPreference): Promise<MediaPlaybackPreference>;
}

export interface PlaybackAuthority {
  readonly state: PlaybackState;
  readonly preference: MediaPlaybackPreference;
  readonly preferenceStatus: PlaybackPreferenceStatus;
  readonly preferenceError: string | null;
  setPreference(value: MediaPlaybackPreference): Promise<MediaPlaybackPreference>;
  select(item: MediaItem): string | null;
  beginCheck(requestId: string): void;
  markReady(requestId: string): void;
  beginLoad(requestId: string): void;
  markPlaying(requestId: string): void;
  markPaused(requestId: string): void;
  markEnded(requestId: string): void;
  markFailed(requestId: string, error: unknown): void;
  reset(): void;
}

const persistentPreferenceStore: PlaybackPreferenceStore = Object.freeze({
  load: loadMediaPlaybackPreference,
  save: saveMediaPlaybackPreference,
});

const PlaybackContext = createContext<PlaybackAuthority | null>(null);

function defaultRequestIdFactory(): string {
  return crypto.randomUUID();
}

export function PlaybackProvider({
  children,
  preferenceStore = persistentPreferenceStore,
  requestIdFactory = defaultRequestIdFactory,
  now = Date.now,
}: {
  readonly children: ReactNode;
  readonly preferenceStore?: PlaybackPreferenceStore;
  readonly requestIdFactory?: () => string;
  readonly now?: () => number;
}) {
  const parent = useContext(PlaybackContext);
  if (parent) throw new Error('PlaybackProvider cannot be nested; one global playback authority is required.');
  return (
    <PlaybackProviderRoot preferenceStore={preferenceStore} requestIdFactory={requestIdFactory} now={now}>
      {children}
    </PlaybackProviderRoot>
  );
}

function PlaybackProviderRoot({
  children,
  preferenceStore,
  requestIdFactory,
  now,
}: {
  readonly children: ReactNode;
  readonly preferenceStore: PlaybackPreferenceStore;
  readonly requestIdFactory: () => string;
  readonly now: () => number;
}) {
  const [state, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK_STATE);
  const [preference, setPreferenceState] = useState<MediaPlaybackPreference>(DEFAULT_MEDIA_PLAYBACK_PREFERENCE);
  const [preferenceStatus, setPreferenceStatus] = useState<PlaybackPreferenceStatus>('loading');
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const preferenceRevisionRef = useRef(0);
  const durablePreferenceRef = useRef<MediaPlaybackPreference>(DEFAULT_MEDIA_PLAYBACK_PREFERENCE);
  const preferenceWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startingRevision = preferenceRevisionRef.current;
    void preferenceStore.load().then((loaded) => {
      if (cancelled || !mountedRef.current || preferenceRevisionRef.current !== startingRevision) return;
      const normalized = normalizeMediaPlaybackPreference(loaded);
      durablePreferenceRef.current = normalized;
      setPreferenceState(normalized);
      setPreferenceStatus('ready');
      setPreferenceError(null);
    }).catch(() => {
      if (cancelled || !mountedRef.current || preferenceRevisionRef.current !== startingRevision) return;
      durablePreferenceRef.current = DEFAULT_MEDIA_PLAYBACK_PREFERENCE;
      setPreferenceState(DEFAULT_MEDIA_PLAYBACK_PREFERENCE);
      setPreferenceStatus('failed');
      setPreferenceError('Could not load the media playback preference. Ask each time will be used.');
    });
    return () => { cancelled = true; };
  }, [preferenceStore]);

  const setPreference = useCallback((value: MediaPlaybackPreference): Promise<MediaPlaybackPreference> => {
    const next = normalizeMediaPlaybackPreference(value);
    const revision = preferenceRevisionRef.current + 1;
    preferenceRevisionRef.current = revision;
    if (mountedRef.current) {
      setPreferenceStatus('loading');
      setPreferenceError(null);
    }

    let resolveResult!: (value: MediaPlaybackPreference) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<MediaPlaybackPreference>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    preferenceWriteQueueRef.current = preferenceWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = normalizeMediaPlaybackPreference(await preferenceStore.save(next));
          durablePreferenceRef.current = saved;
          if (mountedRef.current && preferenceRevisionRef.current === revision) {
            setPreferenceState(saved);
            setPreferenceStatus('ready');
            setPreferenceError(null);
          }
          resolveResult(saved);
        } catch (cause) {
          if (mountedRef.current && preferenceRevisionRef.current === revision) {
            setPreferenceState(durablePreferenceRef.current);
            setPreferenceStatus('failed');
            setPreferenceError('Could not save the media playback preference. The last saved choice is still active.');
          }
          rejectResult(cause);
        }
      });

    return result;
  }, [preferenceStore]);

  const select = useCallback((item: MediaItem): string | null => {
    let timestamp: number;
    try {
      timestamp = now();
    } catch {
      return null;
    }
    if (!Number.isFinite(timestamp) || !isFreshMediaItem(item, timestamp)) return null;

    let requestId: string;
    try {
      requestId = requestIdFactory();
    } catch {
      return null;
    }
    if (!isPlaybackRequestId(requestId)) return null;
    dispatch({ type: 'select', requestId, item });
    return requestId;
  }, [now, requestIdFactory]);

  const beginCheck = useCallback((requestId: string) => dispatch({ type: 'begin-check', requestId }), []);
  const markReady = useCallback((requestId: string) => dispatch({ type: 'ready', requestId }), []);
  const beginLoad = useCallback((requestId: string) => dispatch({ type: 'begin-load', requestId }), []);
  const markPlaying = useCallback((requestId: string) => dispatch({ type: 'play', requestId }), []);
  const markPaused = useCallback((requestId: string) => dispatch({ type: 'pause', requestId }), []);
  const markEnded = useCallback((requestId: string) => dispatch({ type: 'end', requestId }), []);
  const markFailed = useCallback((requestId: string, error: unknown) => dispatch({ type: 'fail', requestId, error }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const value = useMemo<PlaybackAuthority>(() => ({
    state,
    preference,
    preferenceStatus,
    preferenceError,
    setPreference,
    select,
    beginCheck,
    markReady,
    beginLoad,
    markPlaying,
    markPaused,
    markEnded,
    markFailed,
    reset,
  }), [
    beginCheck,
    beginLoad,
    markEnded,
    markFailed,
    markPaused,
    markPlaying,
    markReady,
    preference,
    preferenceError,
    preferenceStatus,
    reset,
    select,
    setPreference,
    state,
  ]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlaybackAuthority(): PlaybackAuthority {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('usePlaybackAuthority must be used within PlaybackProvider.');
  return value;
}
