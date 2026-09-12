/**
 * Lightweight YouTube API key validation.
 *
 * Uses a cheap `videos.list` call (1 quota unit from the shared 10k pool, not
 * from the 100-call search bucket) to confirm the key is accepted by Google.
 * This does not waste the user's daily search allowance.
 *
 * The call is intentionally tiny: part=id, one known public video id.
 */

const VALIDATION_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const VALIDATION_VIDEO_ID = 'jNQXAC9IVRw'; // First YouTube video, always public
const DEFAULT_TIMEOUT_MS = 8_000;

export type YouTubeKeyValidationResult =
  | { readonly valid: true; readonly quotaExhausted?: boolean }
  | { readonly valid: false; readonly reason: 'invalid-key' | 'quota-exceeded' | 'network' | 'unknown'; readonly message: string };

export interface ValidateYouTubeKeyOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function reasonOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as Record<string, unknown>).error as Record<string, unknown> | undefined;
  if (!error || typeof error !== 'object') return undefined;
  const errors = error.errors as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(errors) || !errors.length) return undefined;
  const first = errors[0];
  return typeof first.reason === 'string' ? first.reason : undefined;
}

export async function validateYouTubeApiKey(options: ValidateYouTubeKeyOptions): Promise<YouTubeKeyValidationResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { valid: false, reason: 'invalid-key', message: 'No API key provided.' };
  }

  const runFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = new URL(VALIDATION_ENDPOINT);
  url.searchParams.set('part', 'id');
  url.searchParams.set('id', VALIDATION_VIDEO_ID);
  url.searchParams.set('maxResults', '1');

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await runFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-goog-api-key': key },
        signal: controller.signal,
      });
    } catch {
      return { valid: false, reason: 'network', message: 'Could not reach YouTube. Check your connection.' };
    }

    if (response.ok) {
      // Even if the video id is not found, a 200 means the key was accepted.
      return { valid: true };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const reason = reasonOf(payload);

    if (response.status === 400) {
      return { valid: false, reason: 'invalid-key', message: 'The request was rejected. The key may be malformed.' };
    }
    if (response.status === 401 || response.status === 403) {
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        // Key is valid, but quota exhausted — still a positive signal that it works.
        return { valid: true, quotaExhausted: true };
      }
      if (reason === 'rateLimitExceeded') {
        return { valid: true };
      }
      // keyInvalid, accessNotConfigured, etc.
      return { valid: false, reason: 'invalid-key', message: 'The YouTube API key was rejected. Check that the YouTube Data API v3 is enabled for this key.' };
    }
    if (response.status === 429) {
      return { valid: true };
    }
    if (response.status >= 500) {
      return { valid: false, reason: 'network', message: 'YouTube returned a server error. Try again shortly.' };
    }
    return { valid: false, reason: 'unknown', message: 'YouTube could not validate the key.' };
  } finally {
    clearTimeout(timer);
  }
}
