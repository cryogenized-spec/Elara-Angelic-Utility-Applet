export type ProviderErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'provider'
  | 'unsupported'
  | 'configuration'
  | 'unknown';

export interface NormalizedProviderError {
  category: ProviderErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  cancelled: boolean;
  providerStatus?: number;
  /** Provider string code when supplied (e.g. RESOURCE_EXHAUSTED, ECONNRESET). */
  providerCode?: string;
  requestId?: string;
  interactionId?: string;
  durationMs?: number;
  debug: Record<string, string | number | boolean | null>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function numericStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

/**
 * Bounded recursive walk over SDK/transport wrappers. The js-genai ApiError
 * carries `.status` directly, but wrapped failures surface it under
 * response/cause/error nesting, sometimes as `.code`, sometimes stringified.
 */
function statusFrom(error: unknown, depth = 0): number | undefined {
  if (depth > 3) return undefined;
  const source = record(error);
  const direct = numericStatus(source.status) ?? numericStatus(source.code);
  if (direct !== undefined) return direct;
  for (const key of ['response', 'cause', 'error'] as const) {
    const nested = source[key];
    if (typeof nested === 'object' && nested !== null) {
      const found = statusFrom(nested, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function stringCodeFrom(error: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  const source = record(error);
  const direct = source.code;
  if (typeof direct === 'string' && direct.trim() && numericStatus(direct) === undefined) return direct.trim();
  for (const key of ['cause', 'error', 'response'] as const) {
    const nested = source[key];
    if (typeof nested === 'object' && nested !== null) {
      const found = stringCodeFrom(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const source = record(error);
  const message = source.message;
  if (typeof message === 'string' && message) return message;
  const nestedMessage = record(source.error).message;
  return typeof nestedMessage === 'string' && nestedMessage ? nestedMessage : 'The Gemini request failed.';
}

const NETWORK_CODE_PATTERN =
  /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|NETWORK_ERROR)/i;
const NETWORK_MESSAGE_PATTERN = /failed to fetch|network request failed|load failed|network error|connection (reset|refused|aborted|closed)|offline|no internet/i;
const TIMEOUT_MESSAGE_PATTERN = /timed?\s?out|deadline exceeded/i;

function isNetworkLike(cause: unknown, message: string, code: string | undefined): boolean {
  if (code && NETWORK_CODE_PATTERN.test(code)) return true;
  if (typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'NetworkError') {
    return true;
  }
  return cause instanceof TypeError && NETWORK_MESSAGE_PATTERN.test(message);
}

function isTimeoutLike(message: string, code: string | undefined): boolean {
  if (code && /^(TIMEOUT|DEADLINE_EXCEEDED)$/i.test(code)) return true;
  return TIMEOUT_MESSAGE_PATTERN.test(message);
}

function categoryFor(status: number | undefined): ProviderErrorCategory {
  if (status === 0) return 'network';
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 400 || status === 404 || status === 409 || status === 413 || status === 415 || status === 422) return 'validation';
  if (status === 501) return 'unsupported';
  if (status !== undefined && status >= 500) return 'provider';
  return 'unknown';
}

function retryableFor(category: ProviderErrorCategory, status?: number): boolean {
  return category === 'rate_limit' || category === 'timeout' || category === 'provider' || category === 'network' || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function normalizeGeminiError(cause: unknown, context: { requestId?: string; interactionId?: string; durationMs?: number; category?: ProviderErrorCategory } = {}): NormalizedProviderError {
  const status = statusFrom(cause);
  const message = messageFrom(cause);
  const providerCode = stringCodeFrom(cause);
  const aborted = (cause instanceof DOMException && cause.name === 'AbortError') || status === 499;
  const networkLike = !aborted && (status === 0 || isNetworkLike(cause, message, providerCode));
  const timeoutLike = !aborted && !networkLike && isTimeoutLike(message, providerCode);
  const category = aborted ? 'cancelled' : context.category ?? (networkLike ? 'network' : timeoutLike ? 'timeout' : categoryFor(status));
  const retryable = !aborted && retryableFor(category, status);

  return {
    category,
    code: aborted ? 'GEMINI_REQUEST_CANCELLED' : `GEMINI_${category.toUpperCase()}`,
    message: aborted ? 'The Gemini response was cancelled.' : message,
    retryable,
    cancelled: aborted,
    providerStatus: status,
    providerCode,
    requestId: context.requestId,
    interactionId: context.interactionId,
    durationMs: context.durationMs,
    debug: {
      category,
      providerStatus: status ?? null,
      providerCode: providerCode ?? null,
      retryable,
      cancelled: aborted,
      requestId: context.requestId ?? null,
      interactionId: context.interactionId ?? null,
      durationMs: context.durationMs ?? null,
    },
  };
}
