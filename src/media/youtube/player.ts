import type {
  PlaybackPlayerCallbacks,
  PlaybackPlayerSession,
} from '../playback/player';

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

type YouTubePlayerState = -1 | 0 | 1 | 2 | 3 | 5;

interface YouTubePlayerEvent {
  readonly data: YouTubePlayerState;
}

interface YouTubePlayerErrorEvent {
  readonly data: number;
}

interface YouTubePlayerInstance {
  destroy(): void;
}

interface YouTubePlayerOptions {
  readonly width: string;
  readonly height: string;
  readonly videoId: string;
  readonly playerVars: Readonly<Record<string, string | number>>;
  readonly events: {
    readonly onReady: () => void;
    readonly onStateChange: (event: YouTubePlayerEvent) => void;
    readonly onError: (event: YouTubePlayerErrorEvent) => void;
  };
}

interface YouTubeIframeApi {
  readonly Player: new (target: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerInstance;
}

type YouTubeWindow = Window & typeof globalThis & {
  YT?: YouTubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let iframeApiPromise: Promise<YouTubeIframeApi> | null = null;
let hostOwnerSequence = 0;

function youtubeWindow(): YouTubeWindow {
  return window as YouTubeWindow;
}

function resolvedApi(): YouTubeIframeApi | null {
  const api = youtubeWindow().YT;
  return api && typeof api.Player === 'function' ? api : null;
}

function asError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

function loadIframeApi(): Promise<YouTubeIframeApi> {
  const existing = resolvedApi();
  if (existing) return Promise.resolve(existing);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const targetWindow = youtubeWindow();
    const previousReady = targetWindow.onYouTubeIframeAPIReady;
    let script = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_SRC}"]`);
    let createdScript = false;

    const onError = () => {
      if (createdScript) script?.remove();
      reject(new Error('The YouTube player API could not be loaded.'));
    };

    targetWindow.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch { /* External callback failure is not player authority. */ }
      script?.removeEventListener('error', onError);
      const api = resolvedApi();
      if (api) resolve(api);
      else reject(new Error('The YouTube player API did not initialize correctly.'));
    };

    if (!script) {
      script = document.createElement('script');
      script.src = IFRAME_API_SRC;
      script.async = true;
      script.dataset.elaraYoutubeIframeApi = 'true';
      createdScript = true;
      script.addEventListener('error', onError, { once: true });
      document.head.appendChild(script);
    } else {
      script.addEventListener('error', onError, { once: true });
    }
  }).catch((cause: unknown) => {
    iframeApiPromise = null;
    throw asError(cause, 'The YouTube player API could not be loaded.');
  });

  return iframeApiPromise;
}

function aborted(): DOMException {
  return new DOMException('Playback was cancelled.', 'AbortError');
}

async function waitForIframeApi(signal: AbortSignal): Promise<YouTubeIframeApi> {
  if (signal.aborted) throw aborted();
  const apiPromise = loadIframeApi();
  return new Promise<YouTubeIframeApi>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    apiPromise.then(
      (api) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(aborted());
        else resolve(api);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(asError(cause, 'The YouTube player API could not be loaded.'));
      },
    );
  });
}

function playerErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube rejected the selected video identifier.';
    case 5:
      return 'YouTube could not play this video in the embedded player.';
    case 100:
      return 'This YouTube video is no longer available.';
    case 101:
    case 150:
      return 'This YouTube video does not allow embedded playback.';
    case 153:
      return 'YouTube could not identify this embedded player request.';
    default:
      return 'The YouTube embedded player reported an error.';
  }
}

function playerOrigin(): string | undefined {
  const origin = window.location.origin;
  return /^https?:\/\//.test(origin) ? origin : undefined;
}

/**
 * Create exactly one official YouTube IFrame Player session inside a host owned
 * by the global playback authority. No stored embed URL is accepted here.
 */
export async function createYouTubePlayerSession(
  videoId: string,
  host: HTMLElement,
  signal: AbortSignal,
  callbacks: PlaybackPlayerCallbacks,
): Promise<PlaybackPlayerSession> {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('This YouTube video identifier is not valid for internal playback.');
  }

  const api = await waitForIframeApi(signal);
  if (signal.aborted) throw aborted();

  const owner = `youtube-${++hostOwnerSequence}`;
  host.dataset.elaraPlaybackOwner = owner;
  const mount = document.createElement('div');
  mount.dataset.elaraYoutubePlayerMount = 'true';
  host.replaceChildren(mount);

  let destroyed = false;
  let player: YouTubePlayerInstance | null = null;

  const isLive = () => !destroyed && !signal.aborted && host.dataset.elaraPlaybackOwner === owner;
  const safe = (callback: () => void) => { if (isLive()) callback(); };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    signal.removeEventListener('abort', destroy);
    try { player?.destroy(); } catch { /* Provider teardown must remain idempotent. */ }
    if (host.dataset.elaraPlaybackOwner === owner) {
      delete host.dataset.elaraPlaybackOwner;
      host.replaceChildren();
    }
  };

  signal.addEventListener('abort', destroy, { once: true });

  const playerVars: Record<string, string | number> = {
    autoplay: 0,
    controls: 1,
    playsinline: 1,
  };
  const origin = playerOrigin();
  if (origin) playerVars.origin = origin;

  try {
    player = new api.Player(mount, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars,
      events: {
        onReady: () => safe(callbacks.onReady),
        onStateChange: (event) => {
          if (!isLive()) return;
          if (event.data === 1) callbacks.onPlaying();
          else if (event.data === 2) callbacks.onPaused();
          else if (event.data === 0) callbacks.onEnded();
        },
        onError: (event) => safe(() => callbacks.onError(playerErrorMessage(event.data))),
      },
    });
  } catch {
    destroy();
    throw new Error('The YouTube embedded player could not be created.');
  }

  if (signal.aborted) {
    destroy();
    throw aborted();
  }

  return Object.freeze({ destroy });
}

/** Test seam: the SDK itself remains page-global, but a failed load may retry. */
export function resetYouTubeIframeApiForTests(): void {
  iframeApiPromise = null;
  hostOwnerSequence = 0;
}
