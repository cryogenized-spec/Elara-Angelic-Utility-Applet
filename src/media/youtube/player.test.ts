// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackPlayerCallbacks } from '../playback/player';
import { createYouTubePlayerSession, resetYouTubeIframeApiForTests } from './player';

interface TestPlayerOptions {
  readonly videoId: string;
  readonly width: string;
  readonly height: string;
  readonly playerVars: Readonly<Record<string, string | number>>;
  readonly events: {
    readonly onReady: () => void;
    readonly onStateChange: (event: { readonly data: number }) => void;
    readonly onError: (event: { readonly data: number }) => void;
  };
}

interface TestPlayerInstance {
  destroy(): void;
}

type TestYouTubeWindow = Window & typeof globalThis & {
  YT?: { Player: new (target: HTMLElement, options: TestPlayerOptions) => TestPlayerInstance };
  onYouTubeIframeAPIReady?: () => void;
};

let capturedOptions: TestPlayerOptions | null;
let destroyCalls: number;

class FakePlayer implements TestPlayerInstance {
  constructor(_target: HTMLElement, options: TestPlayerOptions) {
    capturedOptions = options;
  }

  destroy(): void {
    destroyCalls += 1;
  }
}

function targetWindow(): TestYouTubeWindow {
  return window as TestYouTubeWindow;
}

function options(): TestPlayerOptions {
  if (!capturedOptions) throw new Error('Fake YouTube player was not created.');
  return capturedOptions;
}

function callbacks(): PlaybackPlayerCallbacks {
  return {
    onReady: vi.fn(),
    onPlaying: vi.fn(),
    onPaused: vi.fn(),
    onEnded: vi.fn(),
    onError: vi.fn(),
  };
}

beforeEach(() => {
  resetYouTubeIframeApiForTests();
  capturedOptions = null;
  destroyCalls = 0;
  delete targetWindow().YT;
  delete targetWindow().onYouTubeIframeAPIReady;
  document.querySelectorAll('script[data-elara-youtube-iframe-api]').forEach((node) => node.remove());
});

describe('Phase 4 YouTube iframe player adapter', () => {
  it('creates the official player with native controls, inline playback and no autoplay', async () => {
    targetWindow().YT = { Player: FakePlayer };
    const host = document.createElement('div');
    const controller = new AbortController();
    const events = callbacks();

    const session = await createYouTubePlayerSession('a1B2c3D4e5F', host, controller.signal, events);
    const config = options();

    expect(config.videoId).toBe('a1B2c3D4e5F');
    expect(config.width).toBe('100%');
    expect(config.height).toBe('100%');
    expect(config.playerVars.autoplay).toBe(0);
    expect(config.playerVars.controls).toBe(1);
    expect(config.playerVars.playsinline).toBe(1);
    if (/^https?:\/\//.test(window.location.origin)) {
      expect(config.playerVars.origin).toBe(window.location.origin);
    }

    config.events.onReady();
    config.events.onStateChange({ data: 1 });
    config.events.onStateChange({ data: 2 });
    config.events.onStateChange({ data: 0 });

    expect(events.onReady).toHaveBeenCalledTimes(1);
    expect(events.onPlaying).toHaveBeenCalledTimes(1);
    expect(events.onPaused).toHaveBeenCalledTimes(1);
    expect(events.onEnded).toHaveBeenCalledTimes(1);

    session.destroy();
    session.destroy();
    expect(destroyCalls).toBe(1);
    expect(host.childElementCount).toBe(0);
  });

  it('maps provider error codes to bounded application messages', async () => {
    targetWindow().YT = { Player: FakePlayer };
    const events = callbacks();
    const session = await createYouTubePlayerSession(
      'a1B2c3D4e5F',
      document.createElement('div'),
      new AbortController().signal,
      events,
    );

    options().events.onError({ data: 101 });
    expect(events.onError).toHaveBeenCalledWith('This YouTube video does not allow embedded playback.');
    session.destroy();
  });

  it('tears down the player when the elected request is aborted', async () => {
    targetWindow().YT = { Player: FakePlayer };
    const controller = new AbortController();
    const host = document.createElement('div');
    await createYouTubePlayerSession('a1B2c3D4e5F', host, controller.signal, callbacks());

    controller.abort();
    expect(destroyCalls).toBe(1);
    expect(host.childElementCount).toBe(0);
  });

  it('rejects malformed video ids before creating an iframe player', async () => {
    targetWindow().YT = { Player: FakePlayer };
    await expect(createYouTubePlayerSession(
      'not-valid',
      document.createElement('div'),
      new AbortController().signal,
      callbacks(),
    )).rejects.toThrow('not valid');
    expect(capturedOptions).toBeNull();
  });

  it('loads the page-global iframe SDK only once for concurrent callers', async () => {
    const first = createYouTubePlayerSession(
      'a1B2c3D4e5F',
      document.createElement('div'),
      new AbortController().signal,
      callbacks(),
    );
    const second = createYouTubePlayerSession(
      'z9Y8x7W6v5U',
      document.createElement('div'),
      new AbortController().signal,
      callbacks(),
    );

    expect(document.querySelectorAll('script[data-elara-youtube-iframe-api]')).toHaveLength(1);
    targetWindow().YT = { Player: FakePlayer };
    targetWindow().onYouTubeIframeAPIReady?.();

    const [firstSession, secondSession] = await Promise.all([first, second]);
    firstSession.destroy();
    secondSession.destroy();
  });
});
