import { describe, expect, it, vi } from 'vitest';
import { createYouTubeProvider, YouTubeSearchError } from './service';
import type { MediaItem } from '../../domain/media';

const API_KEY = 'AIzaSy-test-key-that-must-never-leak';

function searchResponse(items: unknown[], nextPageToken?: string): Response {
  return new Response(JSON.stringify({
    kind: 'youtube#searchListResponse',
    ...(nextPageToken ? { nextPageToken } : {}),
    pageInfo: { totalResults: 900, resultsPerPage: items.length },
    items,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function videoItem(videoId: string, title: string): unknown {
  return {
    kind: 'youtube#searchResult',
    id: { kind: 'youtube#video', videoId },
    snippet: {
      publishedAt: '2024-05-01T00:00:00Z',
      channelId: 'UC123',
      title,
      description: 'A long description that should not be carried into the item.',
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${videoId}/default.jpg`, width: 120, height: 90 },
        high: { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 },
      },
      channelTitle: 'Ambient Channel',
    },
  };
}

function providerWith(response: () => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return response();
  });
  const provider = createYouTubeProvider({ apiKey: () => API_KEY, fetch: fetchMock as unknown as typeof fetch });
  return { provider, calls, fetchMock };
}

describe('YouTube search adapter', () => {
  it('maps a search response onto the domain contract', async () => {
    const { provider } = providerWith(() => searchResponse([videoItem('abc123', 'Dark Ambient Mix')]));

    const outcome = await provider.search({ query: 'dark ambient' });

    expect(outcome.source).toBe('network');
    expect(outcome.normalizedQuery).toBe('dark ambient');
    expect(outcome.items).toHaveLength(1);
    const item = outcome.items[0] as MediaItem;
    expect(item).toMatchObject({
      provider: 'youtube',
      id: 'abc123',
      kind: 'video',
      title: 'Dark Ambient Mix',
      channel: 'Ambient Channel',
      webUrl: 'https://www.youtube.com/watch?v=abc123',
    });
    // The largest available thumbnail wins.
    expect(item.thumbnail?.url).toContain('hqdefault.jpg');
  });

  it('makes exactly one call and never follows nextPageToken', async () => {
    const { provider, fetchMock } = providerWith(() => searchResponse([videoItem('a', 'One')], 'PAGE_TOKEN_2'));

    const outcome = await provider.search({ query: 'lofi' });

    // Paging would be a whole additional call against a small dedicated bucket.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.items).toHaveLength(1);
  });

  it('never paginates even when the caller asks for more than one page holds', async () => {
    const { provider, fetchMock } = providerWith(() => searchResponse(
      Array.from({ length: 30 }, (_, index) => videoItem(`id${index}`, `Video ${index}`)),
      'PAGE_TOKEN_2',
    ));

    await provider.search({ query: 'lofi', limit: 50 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the key as a header and never in the URL', async () => {
    const { provider, calls } = providerWith(() => searchResponse([videoItem('a', 'One')]));

    await provider.search({ query: 'dark ambient' });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-goog-api-key']).toBe(API_KEY);
    // Query strings reach proxy logs and DevTools history; headers do not.
    expect(calls[0].url).not.toContain(API_KEY);
    expect(calls[0].url).not.toContain('key=');
  });

  it('pins maxResults at the item cap so the model cannot inflate the page', async () => {
    const { provider, calls } = providerWith(() => searchResponse([]));

    await provider.search({ query: 'x', limit: 50 });

    expect(new URL(calls[0].url).searchParams.get('maxResults')).toBe('5');
  });

  it('requests videos with safe search on, at no extra call cost', async () => {
    const { provider, calls } = providerWith(() => searchResponse([]));

    await provider.search({ query: 'x' });

    const params = new URL(calls[0].url).searchParams;
    expect(params.get('type')).toBe('video');
    expect(params.get('safeSearch')).toBe('strict');
    expect(params.get('part')).toBe('snippet');
  });

  it('never produces an embed URL that enables autoplay', async () => {
    const { provider } = providerWith(() => searchResponse([videoItem('abc', 'One')]));

    const { items } = await provider.search({ query: 'x' });

    expect(items[0].embedUrl).toContain('autoplay=0');
    expect(items[0].embedUrl).not.toContain('autoplay=1');
    expect(items[0].embedUrl).toContain('youtube-nocookie.com');
  });

  it('does not call the API at all when no key is configured', async () => {
    const fetchMock = vi.fn();
    const provider = createYouTubeProvider({ apiKey: () => '', fetch: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ reason: 'no-api-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty query without calling the API', async () => {
    const fetchMock = vi.fn();
    const provider = createYouTubeProvider({ apiKey: () => API_KEY, fetch: fetchMock as unknown as typeof fetch });

    await expect(provider.search({ query: '   ' })).rejects.toMatchObject({ reason: 'invalid-request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, undefined, 'invalid-request'],
    [401, undefined, 'no-api-key'],
    [403, 'quotaExceeded', 'quota-exceeded'],
    [403, 'dailyLimitExceeded', 'quota-exceeded'],
    [403, 'rateLimitExceeded', 'rate-limited'],
    [403, 'keyInvalid', 'no-api-key'],
    [429, undefined, 'rate-limited'],
    [503, undefined, 'unknown'],
  ] as const)('classifies HTTP %i (%s) as %s', async (status, reason, expected) => {
    const body = reason ? JSON.stringify({ error: { errors: [{ reason }], message: 'nope' } }) : '{}';
    const provider = createYouTubeProvider({
      apiKey: () => API_KEY,
      fetch: vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch,
    });

    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ reason: expected });
  });

  it('never echoes the key or the raw body in a failure message', async () => {
    const provider = createYouTubeProvider({
      apiKey: () => API_KEY,
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded', message: `request for key ${API_KEY}` }] } }),
        { status: 403 },
      )) as unknown as typeof fetch,
    });

    const error = await provider.search({ query: 'x' }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(YouTubeSearchError);
    expect((error as Error).message).not.toContain(API_KEY);
    expect((error as Error).message).not.toContain('quotaExceeded');
  });

  it('reports a network failure as a network reason', async () => {
    const provider = createYouTubeProvider({
      apiKey: () => API_KEY,
      fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch,
    });

    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ reason: 'network' });
  });

  it('drops malformed items instead of rendering a broken card', async () => {
    const { provider } = providerWith(() => searchResponse([
      videoItem('good', 'Good'),
      { id: { kind: 'youtube#video' }, snippet: { title: 'No videoId' } },
      { id: { kind: 'youtube#video', videoId: 'notitle' }, snippet: {} },
      { id: { kind: 'youtube#channel', channelId: 'UC1' }, snippet: { title: 'Wrong kind' } },
      null,
    ]));

    const { items } = await provider.search({ query: 'x' });

    expect(items.map((item) => item.id)).toEqual(['good']);
  });

  it('returns an empty outcome rather than throwing when nothing matches', async () => {
    const { provider } = providerWith(() => searchResponse([]));

    const outcome = await provider.search({ query: 'zzzz nothing' });

    expect(outcome.items).toEqual([]);
    expect(outcome.source).toBe('network');
  });

  it('propagates an outer abort without masking it as a network error', async () => {
    const controller = new AbortController();
    const provider = createYouTubeProvider({
      apiKey: () => API_KEY,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        // Simulate the request being cancelled mid-flight.
        init?.signal?.addEventListener('abort', () => undefined);
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }) as unknown as typeof fetch,
    });

    await expect(provider.search({ query: 'x', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
