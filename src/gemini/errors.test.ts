import { describe, expect, it } from 'vitest';
import { normalizeGeminiError } from './errors';

function apiErrorLike(status: number, message = 'API failed.'): Error & { status: number } {
  return Object.assign(new Error(message), { name: 'ApiError', status });
}

describe('normalizeGeminiError', () => {
  it('maps a 429 ApiError to a retryable rate-limit failure', () => {
    const error = normalizeGeminiError(apiErrorLike(429, 'Quota exceeded.'), { requestId: 'r-1' });
    expect(error).toMatchObject({
      category: 'rate_limit',
      code: 'GEMINI_RATE_LIMIT',
      message: 'Quota exceeded.',
      retryable: true,
      cancelled: false,
      providerStatus: 429,
      requestId: 'r-1',
    });
  });

  it('finds HTTP status under response/cause/error nesting, including stringified codes', () => {
    expect(normalizeGeminiError({ response: { status: 503 } })).toMatchObject({
      category: 'provider',
      code: 'GEMINI_PROVIDER',
      providerStatus: 503,
      retryable: true,
    });
    expect(normalizeGeminiError({ cause: { cause: { status: 429 } } })).toMatchObject({
      category: 'rate_limit',
      providerStatus: 429,
    });
    expect(normalizeGeminiError(apiErrorLike('429' as unknown as number))).toMatchObject({
      category: 'rate_limit',
      providerStatus: 429,
    });
    expect(normalizeGeminiError(Object.assign(new Error('Bad gateway.'), { code: 502 }))).toMatchObject({
      category: 'provider',
      providerStatus: 502,
    });
  });

  it('preserves provider string codes alongside the normalized category', () => {
    const error = normalizeGeminiError(
      Object.assign(new Error('Quota exceeded.'), { status: 429, code: 'RESOURCE_EXHAUSTED' }),
    );
    expect(error).toMatchObject({ code: 'GEMINI_RATE_LIMIT', providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED' });
    expect(error.debug.providerCode).toBe('RESOURCE_EXHAUSTED');
  });

  it('classifies transport failures as retryable network errors, not unknown', () => {
    expect(normalizeGeminiError(new TypeError('Failed to fetch'))).toMatchObject({
      category: 'network',
      code: 'GEMINI_NETWORK',
      retryable: true,
    });
    expect(normalizeGeminiError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toMatchObject({
      category: 'network',
      providerCode: 'ECONNRESET',
      retryable: true,
    });
    expect(normalizeGeminiError(Object.assign(new Error('No response.'), { status: 0 }))).toMatchObject({
      category: 'network',
    });
  });

  it('does not misclassify ordinary programming TypeErrors as network faults', () => {
    const error = normalizeGeminiError(new TypeError('Cannot read properties of undefined'));
    expect(error.category).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('maps authentication, authorization, timeout, and validation families', () => {
    expect(normalizeGeminiError(apiErrorLike(401))).toMatchObject({ category: 'authentication', retryable: false });
    expect(normalizeGeminiError(apiErrorLike(403))).toMatchObject({ category: 'authorization', retryable: false });
    expect(normalizeGeminiError(apiErrorLike(408))).toMatchObject({ category: 'timeout', retryable: true });
    expect(normalizeGeminiError(apiErrorLike(504))).toMatchObject({ category: 'timeout', retryable: true });
    expect(normalizeGeminiError(apiErrorLike(400))).toMatchObject({ category: 'validation', retryable: false });
    expect(normalizeGeminiError(new Error('Request timed out waiting for headers'))).toMatchObject({
      category: 'timeout',
      retryable: true,
    });
  });

  it('treats 499 and aborts as cancellation', () => {
    expect(normalizeGeminiError(apiErrorLike(499, 'Client closed request.'))).toMatchObject({
      category: 'cancelled',
      code: 'GEMINI_REQUEST_CANCELLED',
      cancelled: true,
      retryable: false,
    });
    expect(normalizeGeminiError(new DOMException('Aborted.', 'AbortError'))).toMatchObject({
      category: 'cancelled',
      cancelled: true,
    });
  });

  it('honors an explicit caller category override', () => {
    const error = normalizeGeminiError(new Error('Gemini stopped responding.'), { category: 'timeout' });
    expect(error).toMatchObject({ category: 'timeout', code: 'GEMINI_TIMEOUT', retryable: true });
  });

  it('maps documented provider string codes when no HTTP status is available', () => {
    expect(normalizeGeminiError({ code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' })).toMatchObject({
      category: 'rate_limit',
      code: 'GEMINI_RATE_LIMIT',
      providerCode: 'RESOURCE_EXHAUSTED',
      retryable: true,
    });
    expect(normalizeGeminiError({ code: 'unavailable', message: 'Try again.' })).toMatchObject({
      category: 'provider',
      retryable: true,
    });
    expect(normalizeGeminiError({ code: 'DEADLINE_EXCEEDED', message: 'Slow.' })).toMatchObject({
      category: 'timeout',
      retryable: true,
    });
    expect(normalizeGeminiError({ code: 'UNAUTHENTICATED', message: 'Bad key.' })).toMatchObject({
      category: 'authentication',
      retryable: false,
    });
  });

  it('lets a numeric status win over any string code', () => {
    expect(normalizeGeminiError({ status: 503, code: 'INVALID_ARGUMENT' })).toMatchObject({
      category: 'provider',
      providerStatus: 503,
      providerCode: 'INVALID_ARGUMENT',
    });
  });

  it('preserves unrecognized provider codes on an honest unknown failure', () => {
    const error = normalizeGeminiError({ code: 'SOME_FUTURE_CODE', message: 'Something new broke.' });
    expect(error).toMatchObject({
      category: 'unknown',
      code: 'GEMINI_UNKNOWN',
      message: 'Something new broke.',
      providerCode: 'SOME_FUTURE_CODE',
      retryable: false,
    });
  });

  it('falls back to non-retryable unknown for opaque failures', () => {
    expect(normalizeGeminiError(new Error('Something odd happened.'))).toMatchObject({
      category: 'unknown',
      code: 'GEMINI_UNKNOWN',
      retryable: false,
    });
  });
});
