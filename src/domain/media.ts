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

/**
 * Known providers. Declared as a const array so the type and the runtime
 * membership check used at the stream-event boundary cannot drift apart: adding
 * a provider is one entry here and nowhere else.
 */
export const MEDIA_PROVIDER_IDS = ['youtube'] as const;

export type MediaProviderId = (typeof MEDIA_PROVIDER_IDS)[number];

export function isMediaProviderId(value: unknown): value is MediaProviderId {
  return typeof value === 'string' && (MEDIA_PROVIDER_IDS as readonly string[]).includes(value);
}

export type MediaKind = 'video' | 'playlist';

/**
 * What the user asked Elara to *do* with the result.
 *
 * This is a presentation and hand-off directive, never a provider parameter:
 * the YouTube request is byte-identical for both intents, which is what lets
 * one cache entry serve a "watch" lookup and a "listen" lookup of the same query
 * without spending a second quota-billed call.
 *
 * - `watch`  — the user wants to see it. Rendered as a playable-looking card.
 * - `listen` — the user wants to hear it. Handed off to the platform's own
 *   player and never played inside Elara.
 *
 * Declared as a const array so the type, the Zod contract, and the runtime
 * membership check cannot drift apart.
 */
export const MEDIA_INTENTS = ['watch', 'listen'] as const;

export type MediaIntent = (typeof MEDIA_INTENTS)[number];

export function isMediaIntent(value: unknown): value is MediaIntent {
  return typeof value === 'string' && (MEDIA_INTENTS as readonly string[]).includes(value);
}

/** The intent assumed when a result predates this field or the caller omitted it. */
export const DEFAULT_MEDIA_INTENT: MediaIntent = 'watch';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * YouTube non-authorized API data must be refreshed or removed after 30 days.
 * Search cache TTLs are much shorter; this ceiling primarily protects media
 * metadata persisted with conversations.
 */
export const MEDIA_API_DATA_MAX_AGE_MS = 30 * DAY_MS;

export interface MediaThumbnail {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface MediaItem {
  readonly provider: MediaProviderId;
  /** Provider-scoped identifier. Unique within `provider`. */
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly channel?: string;
  /** ISO 8601. Optional: not every provider or endpoint returns it. */
  readonly publishedAt?: string;
  /**
   * Optional by design. Resolving it for YouTube needs a second API call
   * (`videos.list`), and the search budget exists to prevent exactly that.
   */
  readonly durationSeconds?: number;
  readonly thumbnail?: MediaThumbnail;
  /** Canonical, user-facing destination. Always present. */
  readonly webUrl: string;
  /**
   * Embeddable URL with autoplay disabled. Present so a future inline player has
   * a correct value to reach for; the invariant that it never enables autoplay
   * is asserted by test rather than by convention.
   */
  readonly embedUrl: string;
  /**
   * Wall-clock time when the provider API returned this metadata.
   *
   * Optional only for backward compatibility with records created before the
   * freshness contract existed. Missing timestamps are treated as untrusted and
   * removed on persistence/cache reads; new provider results always set it.
   */
  readonly apiDataFetchedAt?: number;
  /**
   * How this result should be acted on. Optional because media items are
   * persisted with conversation messages: a result stored before this field
   * existed must still validate and render, falling back to `watch`.
   */
  readonly intent?: MediaIntent;
}

/**
 * Resolves the intent a media item should be rendered with.
 *
 * One function so the card, the hand-off builder, and any later surface agree
 * on the fallback instead of each inventing `?? 'watch'`.
 */
export function mediaIntentOf(item: Pick<MediaItem, 'intent'>): MediaIntent {
  return isMediaIntent(item.intent) ? item.intent : DEFAULT_MEDIA_INTENT;
}

/** Stable provider-scoped identity for one surfaced media resource. */
export function mediaIdentityOf(item: Pick<MediaItem, 'provider' | 'id'>): string {
  return `${item.provider}:${item.id}`;
}

/**
 * Merge a presentation collection without creating duplicate identities.
 *
 * First sighting owns the slot/order; the newest valid representation owns the
 * data in that slot. That makes repeated search results deterministic while
 * allowing a later tool call to change presentation intent or refresh metadata.
 */
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

/** Why a search produced nothing. Surfaced to the model as plain language. */
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
  /** Upper bound on returned items. Never causes an extra API call. */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface MediaSearchOutcome {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly items: readonly MediaItem[];
  /** Whether the answer came from cache, which is the common and desired case. */
  readonly source: 'cache' | 'network';
  readonly truncated: boolean;
}

export interface MediaSearchFailure {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly reason: MediaFailureReason;
  /** Human/model-readable. Must never contain credential material. */
  readonly message: string;
}

export interface MediaProvider {
  readonly id: MediaProviderId;
  search(request: MediaSearchRequest): Promise<MediaSearchOutcome>;
}

/**
 * Hard cap on distinct searches accepted in one model tool call.
 *
 * YouTube's default `search.list` bucket is 100 calls/day. Three keeps even an
 * overeager call bounded to 3% of that bucket while still allowing a genuinely
 * multi-part user request to be answered in one tool invocation. The model is
 * separately instructed to use one query by default.
 */
export const MAX_MEDIA_QUERIES_PER_CALL = 3;

/** Hard cap on items surfaced for one query. */
export const MAX_MEDIA_ITEMS_PER_QUERY = 5;

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
  return isHttpsUrl(thumbnail.url)
    && typeof thumbnail.width === 'number' && Number.isInteger(thumbnail.width) && thumbnail.width > 0 && thumbnail.width <= 10_000
    && typeof thumbnail.height === 'number' && Number.isInteger(thumbnail.height) && thumbnail.height > 0 && thumbnail.height <= 10_000;
}

/**
 * Structural guard shared by the stream-event boundary, persistence cleanup and
 * the card. It validates rather than repairs provider metadata: corrupted or
 * implausible values are rejected so they can never become convincing UI data.
 *
 * `apiDataFetchedAt` may be absent only so legacy IndexedDB rows can be read and
 * explicitly removed by the freshness policy below.
 */
export function isMediaItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const intent = item.intent;
  const fetchedAt = item.apiDataFetchedAt;
  return isMediaProviderId(item.provider)
    && isNonBlankBoundedString(item.id, 128)
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

/**
 * True only while provider metadata is still inside the API-data retention
 * window. A missing, future, malformed or exactly-expired timestamp fails closed.
 */
export function isFreshMediaItem(value: unknown, now: number = Date.now()): value is MediaItem {
  if (!isMediaItem(value)) return false;
  const fetchedAt = value.apiDataFetchedAt;
  return typeof fetchedAt === 'number'
    && fetchedAt <= now
    && now - fetchedAt < MEDIA_API_DATA_MAX_AGE_MS;
}

/** Filter unknown persisted/cache input down to currently displayable media. */
export function freshMediaItems(value: unknown, now: number = Date.now()): MediaItem[] {
  return Array.isArray(value) ? value.filter((item): item is MediaItem => isFreshMediaItem(item, now)) : [];
}
