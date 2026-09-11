import type {
  MediaFailureReason,
  MediaItem,
  MediaProvider,
  MediaSearchOutcome,
  MediaSearchRequest,
  MediaThumbnail,
} from '../../domain/media';
import { MAX_MEDIA_ITEMS_PER_QUERY } from '../../domain/media';
import { normalizeMediaQuery } from '../normalize';

/**
 * Browser-direct YouTube Data API v3 adapter.
 *
 * Three rules here are quota rules, not style preferences:
 *  1. Exactly one `search.list` call per query.
 *  2. Never follow `nextPageToken`. Since the June 2026 quota change,
 *     `search.list` bills against its own small dedicated daily bucket, and
 *     `maxResults` does not change the number of calls — so a second page costs
 *     a whole additional call for marginal benefit.
 *  3. No `videos.list` follow-up for durations. That would double the calls.
 *
 * The API key is supplied per call by a resolver and sent as the
 * `x-goog-api-key` header rather than a query parameter. Query strings are the
 * part of a request that ends up in proxy logs, DevTools history, and error
 * reports; headers do not.
 */

const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const DEFAULT_TIMEOUT_MS = 12_000;

export interface YouTubeSearchOptions {
  /** Resolves the key at call time. Never stored, never logged, never returned. */
  readonly apiKey: () => Promise<string> | string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly maxResults?: number;
}

export class YouTubeSearchError extends Error {
  constructor(readonly reason: MediaFailureReason, message: string) {
    super(message);
    this.name = 'YouTubeSearchError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function pickThumbnail(thumbnails: unknown): MediaThumbnail | undefined {
  if (!isRecord(thumbnails)) return undefined;
  // Prefer the largest of the three that `part=snippet` returns, but accept any.
  for (const size of ['high', 'medium', 'default'] as const) {
    const candidate = thumbnails[size];
    if (!isRecord(candidate)) continue;
    const url = boundedText(candidate.url, 2048);
    if (!url) continue;
    const width = typeof candidate.width === 'number' ? candidate.width : 480;
    const height = typeof candidate.height === 'number' ? candidate.height : 360;
    return { url, width, height };
  }
  return undefined;
}

function toMediaItem(raw: unknown): MediaItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = raw.id;
  const snippet = raw.snippet;
  if (!isRecord(id) || !isRecord(snippet)) return undefined;

  // Only videos are requested, but a defensive check keeps a future `type`
  // change from silently producing broken watch URLs.
  const kind = id.kind === 'youtube#playlist' ? 'playlist' : id.kind === 'youtube#video' ? 'video' : undefined;
  const resourceId = kind === 'playlist' ? boundedText(id.playlistId, 64) : boundedText(id.videoId, 64);
  if (!kind || !resourceId) return undefined;

  const title = boundedText(snippet.title, 300);
  if (!title) return undefined;

  const webUrl = kind === 'playlist'
    ? `https://www.youtube.com/playlist?list=${encodeURIComponent(resourceId)}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(resourceId)}`;

  return {
    provider: 'youtube',
    id: resourceId,
    kind,
    title,
    ...(boundedText(snippet.channelTitle, 200) ? { channel: boundedText(snippet.channelTitle, 200) } : {}),
    ...(boundedText(snippet.publishedAt, 40) ? { publishedAt: boundedText(snippet.publishedAt, 40) } : {}),
    ...(pickThumbnail(snippet.thumbnails) ? { thumbnail: pickThumbnail(snippet.thumbnails) } : {}),
    webUrl,
    // Autoplay stays off. This invariant is asserted by test, not by comment.
    embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(resourceId)}?autoplay=0`,
  };
}

/**
 * Map a provider failure onto the domain vocabulary. The raw body is never
 * propagated: it is large, uninteresting to the user, and the one place a
 * request echo could leak into a log or an error report.
 */
function classify(status: number, reason: string | undefined): YouTubeSearchError {
  switch (status) {
    case 400: return new YouTubeSearchError('invalid-request', 'The YouTube search request was rejected as malformed.');
    case 401:
    case 403: {
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        return new YouTubeSearchError('quota-exceeded', 'YouTube API quota for this key is exhausted. It resets at midnight Pacific time.');
      }
      if (reason === 'rateLimitExceeded') {
        return new YouTubeSearchError('rate-limited', 'YouTube is rate-limiting this key. Try again shortly.');
      }
      return new YouTubeSearchError('no-api-key', 'The YouTube API key was rejected. Check it in Settings and that the YouTube Data API v3 is enabled.');
    }
    case 429: return new YouTubeSearchError('rate-limited', 'YouTube is rate-limiting this key. Try again shortly.');
    default:
      return status >= 500
        ? new YouTubeSearchError('unknown', 'YouTube returned a server error. Try again shortly.')
        : new YouTubeSearchError('unknown', 'YouTube could not complete the search.');
  }
}

function reasonOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (!isRecord(error)) return undefined;
  const errors = error.errors;
  if (!Array.isArray(errors) || !errors.length) return undefined;
  const first = errors[0];
  return isRecord(first) ? boundedText(first.reason, 64) : undefined;
}

export function createYouTubeProvider(options: YouTubeSearchOptions): MediaProvider {
  const runFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxResults = Math.min(Math.max(options.maxResults ?? MAX_MEDIA_ITEMS_PER_QUERY, 1), MAX_MEDIA_ITEMS_PER_QUERY);

  async function search(request: MediaSearchRequest): Promise<MediaSearchOutcome> {
    const query = request.query.trim();
    const normalizedQuery = normalizeMediaQuery(query);
    if (!normalizedQuery) {
      throw new YouTubeSearchError('invalid-request', 'A non-empty search query is required.');
    }

    const key = (await options.apiKey()).trim();
    if (!key) {
      throw new YouTubeSearchError('no-api-key', 'No YouTube API key is configured. Add one in Settings to search YouTube.');
    }

    // `type=video` + `safeSearch=strict`: this is a conversational assistant, and
    // neither filter costs an extra call.
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('safeSearch', 'strict');

    let response: Response;
    try {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onOuterAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        response = await runFetch(url, {
          method: 'GET',
          headers: { accept: 'application/json', 'x-goog-api-key': key },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onOuterAbort);
      }
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw new YouTubeSearchError('network', 'Could not reach the YouTube Data API. Check the connection and try again.');
    }

    if (!response.ok) {
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = undefined; }
      throw classify(response.status, reasonOf(payload));
    }

    const payload: unknown = await response.json();
    const rawItems = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
    const items: MediaItem[] = [];
    // `nextPageToken` is deliberately ignored. See the module rules.
    for (const raw of rawItems) {
      if (items.length >= maxResults) break;
      const item = toMediaItem(raw);
      if (item) items.push(item);
    }

    return Object.freeze({
      query,
      normalizedQuery,
      items: Object.freeze(items),
      source: 'network' as const,
      truncated: rawItems.length > items.length,
    });
  }

  return { id: 'youtube', search };
}
