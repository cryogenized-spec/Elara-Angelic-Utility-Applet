import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkYouTubePlaybackReadiness,
  resetYouTubePlaybackReadinessCache,
} from './readiness';

const VIDEO_ID = 'a1B2c3D4e5F';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => resetYouTubePlaybackReadinessCache());

describe('YouTube playback readiness', () => {
  it('uses one cheap videos.list request with header-only credentials and caches the ready decision for the session', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const runFetch: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ items: [{ id: VIDEO_ID, status: { embeddable: true, madeForKids: false } }] });
    };
    const controller = new AbortController();

    const first = await checkYouTubePlaybackReadiness(VIDEO_ID, controller.signal, {
      apiKey: () => 'phase3-secret-key',
      fetch: runFetch,
    });
    const second = await checkYouTubePlaybackReadiness(VIDEO_ID, controller.signal, {
      apiKey: () => { throw new Error('cache should avoid credential access'); },
      fetch: async () => { throw new Error('cache should avoid network'); },
    });

    expect(first).toEqual({ status: 'ready' });
    expect(second).toEqual({ status: 'ready' });
    expect(calls).toHaveLength(1);

    const url = new URL(String(calls[0].input));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(url.searchParams.get('part')).toBe('id,status');
    expect(url.searchParams.get('id')).toBe(VIDEO_ID);
    expect(url.searchParams.get('maxResults')).toBe('1');
    expect(url.searchParams.has('key')).toBe(false);
    expect(new Headers(calls[0].init?.headers).get('x-goog-api-key')).toBe('phase3-secret-key');
  });

  it('fails closed before credentials or network for malformed video ids', async () => {
    let keyReads = 0;
    let networkCalls = 0;
    const result = await checkYouTubePlaybackReadiness('not a youtube id', new AbortController().signal, {
      apiKey: () => { keyReads += 1; return 'secret'; },
      fetch: async () => { networkCalls += 1; return jsonResponse({ items: [] }); },
    });

    expect(result).toMatchObject({ status: 'blocked', reason: 'invalid-target' });
    expect(keyReads).toBe(0);
    expect(networkCalls).toBe(0);
  });

  it('classifies unavailable, non-embeddable and Made-for-Kids videos without creating a player', async () => {
    const cases = [
      { body: { items: [] }, reason: 'unavailable' },
      { body: { items: [{ id: VIDEO_ID, status: { embeddable: false, madeForKids: false } }] }, reason: 'not-embeddable' },
      { body: { items: [{ id: VIDEO_ID, status: { embeddable: true, madeForKids: true } }] }, reason: 'made-for-kids' },
    ] as const;

    for (const entry of cases) {
      resetYouTubePlaybackReadinessCache();
      const result = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
        apiKey: () => 'secret',
        fetch: async () => jsonResponse(entry.body),
      });
      expect(result).toMatchObject({ status: 'blocked', reason: entry.reason });
    }
  });

  it('requires explicit embeddable and Made-for-Kids status instead of guessing missing provider data', async () => {
    const result = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'secret',
      fetch: async () => jsonResponse({ items: [{ id: VIDEO_ID, status: { embeddable: true } }] }),
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'invalid-response' });
  });

  it('maps credential, quota and rate-limit failures onto bounded application decisions', async () => {
    const missing = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => '',
      fetch: async () => { throw new Error('should not call'); },
    });
    expect(missing).toMatchObject({ status: 'failed', reason: 'no-api-key' });

    resetYouTubePlaybackReadinessCache();
    const quota = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'secret',
      fetch: async () => jsonResponse({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403),
    });
    expect(quota).toMatchObject({ status: 'failed', reason: 'quota-exceeded' });

    resetYouTubePlaybackReadinessCache();
    const rate = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'secret',
      fetch: async () => jsonResponse({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403),
    });
    expect(rate).toMatchObject({ status: 'failed', reason: 'rate-limited' });
  });

  it('treats caller cancellation as cancellation, not a playback failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await checkYouTubePlaybackReadiness(VIDEO_ID, controller.signal, {
      apiKey: () => { throw new Error('should not read key'); },
      fetch: async () => { throw new Error('should not call network'); },
    });
    expect(result).toEqual({ status: 'aborted' });
  });
});
