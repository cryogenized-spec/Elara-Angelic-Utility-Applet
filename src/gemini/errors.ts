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
  requestId?: string;
  interactionId?: string;
  durationMs?: number;
  debug: Record<string, string | number | boolean | null>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function statusFrom(error: unknown): number | undefined {
  const source = record(error);
  const direct = source.status;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const responseStatus = record(source.response).status;
  if (typeof responseStatus === 'number' && Number.isFinite(responseStatus)) return responseStatus;

  const causeStatus = record(source.cause).status;
  if (typeof causeStatus === 'number' && Number.isFinite(causeStatus)) return causeStatus;

  const details = record(source.error);
  const nestedStatus = details.status;
  if (typeof nestedStatus === 'number' && Number.isFinite(nestedStatus)) return nestedStatus;

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

function categoryFor(status: number | undefined): ProviderErrorCategory {
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

export function normalizeGeminiError(cause: unknown, context: { requestId?: string; interactionId?: string; durationMs?: number } = {}): NormalizedProviderError {
  const status = statusFrom(cause);
  const message = messageFrom(cause);
  const aborted = cause instanceof DOMException && cause.name === 'AbortError';
  const category = aborted ? 'cancelled' : categoryFor(status);

  return {
    category,
    code: aborted ? 'GEMINI_REQUEST_CANCELLED' : `GEMINI_${category.toUpperCase()}`,
    message: aborted ? 'The Gemini response was cancelled.' : message,
    retryable: !aborted && retryableFor(category, status),
    cancelled: aborted,
    providerStatus: status,
    requestId: context.requestId,
    interactionId: context.interactionId,
    durationMs: context.durationMs,
    debug: {
      category,
      providerStatus: status ?? null,
      retryable: !aborted && retryableFor(category, status),
      cancelled: aborted,
      requestId: context.requestId ?? null,
      interactionId: context.interactionId ?? null,
      durationMs: context.durationMs ?? null,
    },
  };
}
