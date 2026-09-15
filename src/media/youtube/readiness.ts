import type { PlaybackReadinessDecision } from '../../domain/playback';
import { getYouTubeApiKey } from '../../persistence/gemini-api-key';

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface YouTubePlaybackReadinessOptions {
  readonly apiKey?: () => Promise<string> | string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Session-only derived provider metadata. Never persisted and never player state. */
const readinessCache = new Map<string, PlaybackReadinessDecision>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reasonOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (!isRecord(error) || !Array.isArray(error.errors) || error.errors.length === 0) return undefined;
  const first: unknown = error.errors[0];
  if (!isRecord(first) || typeof first.reason !== 'string') return undefined;
  const reason = first.reason.trim();
  return reason && reason.length <= 64 ? reason : undefined;
}

function failed(reason: Extract<PlaybackReadinessDecision, { status: 'failed' }>['reason'], message: string): PlaybackReadinessDecision {
  return Object.freeze({ status: 'failed' as const, reason, message });
}

function blocked(reason: Extract<PlaybackReadinessDecision, { status: 'blocked' }>['reason'], message: string): PlaybackReadinessDecision {
  return Object.freeze({ status: 'blocked' as const, reason, message });
}

function classifyHttpFailure(status: number, reason: string | undefined): PlaybackReadinessDecision {
  if (status === 401 || status === 403) {
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      return failed('quota-exceeded', 'YouTube quota is exhausted, so internal playback could not be checked.');
    }
    if (reason === 'rateLimitExceeded') {
      return failed('rate-limited', 'YouTube is rate-limiting readiness checks. Try again shortly.');
    }
    return failed('no-api-key', 'The YouTube API key is unavailable or was rejected. Unlock the Lockbox or check the key.');
  }
  if (status === 429) {
    return failed('rate-limited', 'YouTube is rate-limiting readiness checks. Try again shortly.');
  }
  if (status >= 500) {
    return failed('network', 'YouTube returned a server error while checking internal playback.');
  }
  return failed('invalid-response', 'YouTube could not verify this video for internal playback.');
}

function cacheable(decision: PlaybackReadinessDecision): boolean {
  return decision.status === 'ready' || decision.status === 'blocked';
}

/** Test seam only; runtime freshness is intentionally the browser session. */
export function resetYouTubePlaybackReadinessCache(): void {
  readinessCache.clear();
}

/**
 * Check whether one exact YouTube video may proceed to the future iframe phase.
 *
 * This uses videos.list only after the application playback authority has elected
 * a media item. It does not consume the search-specific budget, does not create a
 * player, and does not trust a stored embed URL. Made-for-Kids videos are kept
 * external-only until the iframe phase explicitly implements and certifies that
 * policy surface.
 */
export async function checkYouTubePlaybackReadiness(
  videoId: string,
  signal: AbortSignal,
  options: YouTubePlaybackReadinessOptions = {},
): Promise<PlaybackReadinessDecision> {
  if (signal.aborted) return { status: 'aborted' };
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return blocked('invalid-target', 'This YouTube video identifier is not valid for internal playback.');
  }

  const cached = readinessCache.get(videoId);
  if (cached) return cached;

  let key: string;
  try {
    key = String(await (options.apiKey ?? getYouTubeApiKey)()).trim();
  } catch {
    return failed('no-api-key', 'The YouTube API key is unavailable. Unlock the Lockbox to check internal playback.');
  }
  // Credential retrieval may itself be asynchronous. If the elected playback
  // request was superseded or reset during that await, do not start provider
  // work for a request that no longer owns the readiness lane.
  if (signal.aborted) return { status: 'aborted' };
  if (!key) {
    return failed('no-api-key', 'The YouTube API key is unavailable. Unlock the Lockbox to check internal playback.');
  }

  const url = new URL(VIDEOS_ENDPOINT);
  url.searchParams.set('part', 'id,status');
  url.searchParams.set('id', videoId);
  url.searchParams.set('maxResults', '1');

  const runFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });

  let response: Response;
  try {
    try {
      response = await runFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-goog-api-key': key },
        signal: controller.signal,
      });
    } catch {
      if (signal.aborted) return { status: 'aborted' };
      if (timedOut) return failed('network', 'YouTube did not answer the internal playback check in time.');
      return failed('network', 'Could not reach YouTube to check internal playback.');
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }

  if (signal.aborted) return { status: 'aborted' };

  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (signal.aborted) return { status: 'aborted' };
    return classifyHttpFailure(response.status, reasonOf(payload));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) return { status: 'aborted' };
    return failed('invalid-response', 'YouTube returned an unreadable readiness response.');
  }
  if (signal.aborted) return { status: 'aborted' };

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return failed('invalid-response', 'YouTube returned an invalid readiness response.');
  }

  const items: unknown[] = payload.items;
  const matching: unknown = items.find((candidate) => isRecord(candidate) && candidate.id === videoId);
  let decision: PlaybackReadinessDecision;

  if (!isRecord(matching)) {
    decision = blocked('unavailable', 'This YouTube video is no longer available for internal playback.');
  } else {
    const status = matching.status;
    if (!isRecord(status)
      || typeof status.embeddable !== 'boolean'
      || typeof status.madeForKids !== 'boolean') {
      return failed('invalid-response', 'YouTube did not return enough status information to verify internal playback safely.');
    }
    if (status.madeForKids) {
      decision = blocked('made-for-kids', 'This Made for Kids video will open on YouTube instead of playing inside Elara.');
    } else if (!status.embeddable) {
      decision = blocked('not-embeddable', 'This YouTube video does not allow embedded playback.');
    } else {
      decision = Object.freeze({ status: 'ready' as const });
    }
  }

  if (cacheable(decision)) readinessCache.set(videoId, decision);
  return decision;
}
