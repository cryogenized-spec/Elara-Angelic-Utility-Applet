import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkYouTubePlaybackReadiness,
  resetYouTubePlaybackReadinessCache,
} from './readiness';

const VIDEO_ID = 'a1B2c3D4e5F';

function readyResponse(): Response {
  return new Response(JSON.stringify({
    items: [{ id: VIDEO_ID, status: { embeddable: true, madeForKids: false } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => resetYouTubePlaybackReadinessCache());

describe('Phase 8 adversarial YouTube readiness', () => {
  it('bounds a hung provider request with the existing timeout and reports a network failure', async () => {
    const fetchNeverCompletes: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });

    const result = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'phase8-key',
      fetch: fetchNeverCompletes,
      timeoutMs: 5,
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'network',
      message: 'YouTube did not answer the internal playback check in time.',
    });
  });

  it('does not cache transient network failure, so a later retry can recover', async () => {
    let calls = 0;
    const runFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('offline');
      return readyResponse();
    };

    const first = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'phase8-key',
      fetch: runFetch,
    });
    const second = await checkYouTubePlaybackReadiness(VIDEO_ID, new AbortController().signal, {
      apiKey: () => 'phase8-key',
      fetch: runFetch,
    });

    expect(first).toMatchObject({ status: 'failed', reason: 'network' });
    expect(second).toEqual({ status: 'ready' });
    expect(calls).toBe(2);
  });

  it('cancels during asynchronous credential lookup before any provider request can start', async () => {
    const outer = new AbortController();
    let releaseKey!: (value: string) => void;
    let fetchCalls = 0;
    const key = new Promise<string>((resolve) => { releaseKey = resolve; });

    const check = checkYouTubePlaybackReadiness(VIDEO_ID, outer.signal, {
      apiKey: () => key,
      fetch: async () => {
        fetchCalls += 1;
        return readyResponse();
      },
    });

    outer.abort();
    releaseKey('phase8-key');

    await expect(check).resolves.toEqual({ status: 'aborted' });
    expect(fetchCalls).toBe(0);
  });

  it('propagates cancellation into a provider request that is already pending', async () => {
    const outer = new AbortController();
    let innerAborted = false;
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const pendingFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      fetchStarted();
      init?.signal?.addEventListener('abort', () => {
        innerAborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });

    const check = checkYouTubePlaybackReadiness(VIDEO_ID, outer.signal, {
      apiKey: () => 'phase8-key',
      fetch: pendingFetch,
      timeoutMs: 5_000,
    });
    await started;
    outer.abort();

    await expect(check).resolves.toEqual({ status: 'aborted' });
    expect(innerAborted).toBe(true);
  });
});
