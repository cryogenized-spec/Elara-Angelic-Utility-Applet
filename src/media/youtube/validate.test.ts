import { describe, expect, it, vi } from 'vitest';
import { validateYouTubeApiKey } from './validate';

const API_KEY = 'AIzaSy-test-key';

function response(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : '{}', { status, headers: { 'content-type': 'application/json' } });
}

describe('YouTube API key validation', () => {
  it('returns valid for a 200 response', async () => {
    const fetchMock = vi.fn(async () => response(200, { items: [{ id: 'jNQXAC9IVRw' }] }));
    const result = await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(result.valid).toBe(true);
  });

  it('treats quotaExceeded as valid with quotaExhausted flag', async () => {
    const fetchMock = vi.fn(async () => response(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }));
    const result = await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(result).toEqual({ valid: true, quotaExhausted: true });
  });

  it('returns invalid for keyInvalid', async () => {
    const fetchMock = vi.fn(async () => response(403, { error: { errors: [{ reason: 'keyInvalid' }] } }));
    const result = await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('invalid-key');
  });

  it('sends key as header not in URL', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return response(200, { items: [] });
    });
    await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(calls[0].headers['x-goog-api-key']).toBe(API_KEY);
    expect(calls[0].url).not.toContain(API_KEY);
    expect(calls[0].url).not.toContain('key=');
  });

  it('uses a cheap videos.list call, not search.list', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return response(200, { items: [] });
    });
    await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    const url = new URL(calls[0]);
    expect(url.pathname).toContain('/youtube/v3/videos');
    expect(url.searchParams.get('part')).toBe('id');
    expect(url.searchParams.get('id')).toBeTruthy();
  });

  it('returns network on fetch failure', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const result = await validateYouTubeApiKey({ apiKey: API_KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('network');
  });
});
