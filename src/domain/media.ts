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

/** Hard cap on queries accepted in one tool call. */
export const MAX_MEDIA_QUERIES_PER_CALL = 8;

/** Hard cap on items surfaced for one query. */
export const MAX_MEDIA_ITEMS_PER_QUERY = 5;

/**
 * Structural guard shared by the stream-event boundary and the card.
 *
 * One validator, used on both sides, so a malformed item is rejected once and
 * consistently rather than half-rendered in the UI.
 */
export function isMediaItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isMediaProviderId(item.provider)
    && typeof item.id === 'string' && item.id.length > 0
    && (item.kind === 'video' || item.kind === 'playlist')
    && typeof item.title === 'string' && item.title.length > 0
    && typeof item.webUrl === 'string' && item.webUrl.length > 0
    && typeof item.embedUrl === 'string' && item.embedUrl.length > 0;
}
