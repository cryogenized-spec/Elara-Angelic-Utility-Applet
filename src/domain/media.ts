/**
 * Media domain contract.
 *
 * Deliberately provider-agnostic, and deliberately small. Nothing in here knows
 * what a YouTube search response looks like; provider adapters translate into
 * these shapes and no provider SDK types cross this boundary. That is what
 * makes a second provider an addition rather than a refactor of the tool loop,
 * the stream event, or the card.
 *
 * These values are rendered and may be persisted with a conversation message, so
 * they must never carry credentials. Adapters are responsible for that.
 */

export const MEDIA_PROVIDER_IDS = ['youtube'] as const;
export type MediaProviderId = (typeof MEDIA_PROVIDER_IDS)[number];

export function isMediaProviderId(value: unknown): value is MediaProviderId {
  return typeof value === 'string' && (MEDIA_PROVIDER_IDS as readonly string[]).includes(value);
}

export type MediaKind = 'video' | 'playlist';

/**
 * What the user asked Elara to *do* with the result. Intent is presentation and
 * hand-off state, never part of the provider request or cache identity.
 */
export const MEDIA_INTENTS = ['watch', 'listen'] as const;
export type MediaIntent = (typeof MEDIA_INTENTS)[number];

export function isMediaIntent(value: unknown): value is MediaIntent {
  return typeof value === 'string' && (MEDIA_INTENTS as readonly string[]).includes(value);
}

export const DEFAULT_MEDIA_INTENT: MediaIntent = 'watch';

const DAY_MS = 24 * 60 * 60 * 1000;

/** YouTube non-authorized API data must be refreshed or removed after 30 days. */
export const MEDIA_API_DATA_MAX_AGE_MS = 30 * DAY_MS;

export interface MediaThumbnail {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface MediaItem {
  readonly provider: MediaProviderId;
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly channel?: string;
  readonly publishedAt?: string;
  readonly durationSeconds?: number;
  readonly thumbnail?: MediaThumbnail;
  readonly webUrl: string;
  readonly embedUrl: string;
  /** Wall-clock time when the provider API returned this metadata. */
  readonly apiDataFetchedAt?: number;
  readonly intent?: MediaIntent;
}

export function mediaIntentOf(item: Pick<MediaItem, 'intent'>): MediaIntent {
  return isMediaIntent(item.intent) ? item.intent : DEFAULT_MEDIA_INTENT;
}

export function mediaIdentityOf(item: Pick<MediaItem, 'provider' | 'id'>): string {
  return `${item.provider}:${item.id}`;
}

/** First sighting owns order; newest valid representation owns the slot data. */
export function mergeMediaItems(current: readonly MediaItem[], incoming: readonly MediaItem[]): MediaItem[] {
  if (incoming.length === 0) return [...current];
  const merged = [...current];
  const positions = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) positions.set(mediaIdentityOf(merged[index]), index);
  for (const item of incoming) {
    const identity = mediaIdentityOf(item);
    const position = positions.get(identity);
    if (position === undefined) {
      positions.set(identity, merged.length);
      merged.push(item);
    } else {
      merged[position] = item;
    }
  }
  return merged;
}

export type MediaFailureReason =
  | 'no-api-key'
  | 'budget-exhausted'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'network'
  | 'invalid-request'
  | 'no-results'
  | 'unknown';

export interface MediaSearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface MediaSearchOutcome {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly items: readonly MediaItem[];
  readonly source: 'cache' | 'network';
  readonly truncated: boolean;
}

export interface MediaSearchFailure {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly reason: MediaFailureReason;
  readonly message: string;
}

export interface MediaProvider {
  readonly id: MediaProviderId;
  search(request: MediaSearchRequest): Promise<MediaSearchOutcome>;
}

/**
 * Hard cap on distinct searches accepted in one model tool call. YouTube's
 * default search bucket is 100 calls/day; one tool call can spend at most 3%.
 */
export const MAX_MEDIA_QUERIES_PER_CALL = 3;
export const MAX_MEDIA_ITEMS_PER_QUERY = 5;

const MEDIA_ITEM_KEYS = new Set([
  'provider', 'id', 'kind', 'title', 'channel', 'publishedAt', 'durationSeconds',
  'thumbnail', 'webUrl', 'embedUrl', 'apiDataFetchedAt', 'intent',
]);
const MEDIA_THUMBNAIL_KEYS = new Set(['url', 'width', 'height']);

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function isNonBlankBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isMediaThumbnail(value: unknown): value is MediaThumbnail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const thumbnail = value as Record<string, unknown>;
  return hasOnlyKeys(thumbnail, MEDIA_THUMBNAIL_KEYS)
    && isHttpsUrl(thumbnail.url)
    && typeof thumbnail.width === 'number' && Number.isInteger(thumbnail.width) && thumbnail.width > 0 && thumbnail.width <= 10_000
    && typeof thumbnail.height === 'number' && Number.isInteger(thumbnail.height) && thumbnail.height > 0 && thumbnail.height <= 10_000;
}

/**
 * Structural guard shared by stream events and persisted data. Unexpected fields
 * are rejected rather than silently retained, which prevents a corrupted row
 * from smuggling credential-like material through a trusted MediaItem object.
 * `apiDataFetchedAt` may be absent only so legacy rows can be identified and
 * explicitly removed by the freshness policy.
 */
export function isMediaItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const intent = item.intent;
  const fetchedAt = item.apiDataFetchedAt;
  return hasOnlyKeys(item, MEDIA_ITEM_KEYS)
    && isMediaProviderId(item.provider)
    && isNonBlankBoundedString(item.id, 128)
    && item.id.trim() === item.id && !/\s/.test(item.id)
    && (item.kind === 'video' || item.kind === 'playlist')
    && isNonBlankBoundedString(item.title, 1_000)
    && (item.channel === undefined || isNonBlankBoundedString(item.channel, 1_000))
    && (item.publishedAt === undefined || isNonBlankBoundedString(item.publishedAt, 64))
    && (item.durationSeconds === undefined || (typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds) && item.durationSeconds >= 0))
    && (item.thumbnail === undefined || isMediaThumbnail(item.thumbnail))
    && isHttpsUrl(item.webUrl)
    && isHttpsUrl(item.embedUrl)
    && (fetchedAt === undefined || (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0))
    && (intent === undefined || isMediaIntent(intent));
}

/** Missing, future, malformed or exactly-expired API-data timestamps fail closed. */
export function isFreshMediaItem(value: unknown, now: number = Date.now()): value is MediaItem {
  if (!isMediaItem(value)) return false;
  const fetchedAt = value.apiDataFetchedAt;
  return typeof fetchedAt === 'number'
    && fetchedAt <= now
    && now - fetchedAt < MEDIA_API_DATA_MAX_AGE_MS;
}

export function freshMediaItems(value: unknown, now: number = Date.now()): MediaItem[] {
  return Array.isArray(value) ? value.filter((item): item is MediaItem => isFreshMediaItem(item, now)) : [];
}
