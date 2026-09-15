// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../domain/media';
import type { MediaPlaybackPreference } from '../../domain/playback';
import {
  PlaybackProvider,
  usePlaybackAuthority,
  type PlaybackAuthority,
  type PlaybackPreferenceStore,
} from './PlaybackProvider';
import type { PlaybackPlayerCallbacks, PlaybackPlayerPort } from './player';
import type { PlaybackReadinessPort } from './readiness';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;
const ITEM_A: MediaItem = {
  provider: 'youtube',
  id: 'a1B2c3D4e5F',
  kind: 'video',
  title: 'Adversarial Track A',
  channel: 'Elara Test',
  thumbnail: { url: 'https://i.ytimg.com/vi/a1B2c3D4e5F/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
  apiDataFetchedAt: NOW - 1_000,
  intent: 'watch',
};
const ITEM_B: MediaItem = {
  ...ITEM_A,
  id: 'z9Y8x7W6v5U',
  title: 'Adversarial Track B',
  webUrl: 'https://www.youtube.com/watch?v=z9Y8x7W6v5U',
};

const readyPort: PlaybackReadinessPort = {
  check: async () => ({ status: 'ready' }),
};

let container: HTMLDivElement;
let root: Root;
let authority: PlaybackAuthority | null;

function Probe() {
  const current = usePlaybackAuthority();
  useEffect(() => { authority = current; }, [current]);
  return <output data-phase={current.state.phase} data-preference={current.preference} data-preference-status={current.preferenceStatus} />;
}

function currentAuthority(): PlaybackAuthority {
  if (!authority) throw new Error('Playback authority probe has not mounted.');
  return authority;
}

function memoryStore(initial: MediaPlaybackPreference = 'ask'): PlaybackPreferenceStore {
  return {
    load: async () => initial,
    save: async (value) => value,
  };
}

async function renderProvider(options: {
  readonly playerPort: PlaybackPlayerPort;
  readonly readinessPort?: PlaybackReadinessPort;
  readonly preferenceStore?: PlaybackPreferenceStore;
  readonly requestIds?: readonly string[];
}): Promise<void> {
  let index = 0;
  const requestIds = options.requestIds ?? Array.from({ length: 32 }, (_, position) => `phase8-${position + 1}`);
  await act(async () => {
    root.render(
      <PlaybackProvider
        preferenceStore={options.preferenceStore ?? memoryStore()}
        readinessPort={options.readinessPort ?? readyPort}
        playerPort={options.playerPort}
        requestIdFactory={() => requestIds[index++] ?? `phase8-overflow-${index}`}
        now={() => NOW}
      >
        <Probe />
      </PlaybackProvider>,
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  authority = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Phase 8 adversarial playback verification', () => {
  it('contains a synchronous player adapter throw inside the existing failed phase', async () => {
    const load: PlaybackPlayerPort['load'] = () => {
      throw new Error('synchronous adapter explosion');
    };
    await renderProvider({ playerPort: { load } });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });

    expect(currentAuthority().state).toMatchObject({
      phase: 'failed',
      item: { id: ITEM_A.id },
      error: 'The embedded YouTube player could not be loaded.',
    });
    expect(container.querySelector<HTMLElement>('.playback-player-surface')?.hidden).toBe(true);
  });

  it('treats a throwing provider destroy as best-effort cleanup and still resets authoritatively', async () => {
    let signal!: AbortSignal;
    const destroy = vi.fn(() => { throw new Error('destroy failed'); });
    const load = vi.fn<PlaybackPlayerPort['load']>(async (_item, _host, currentSignal) => {
      signal = currentSignal;
      return { destroy };
    });
    await renderProvider({ playerPort: { load } });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });
    expect(currentAuthority().state.phase).toBe('loading');

    act(() => currentAuthority().reset());

    expect(signal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null });
  });

  it('survives repeated start/reset cycles with exactly one global host and no leaked elected sessions', async () => {
    const sessions: Array<{ signal: AbortSignal; destroy: ReturnType<typeof vi.fn> }> = [];
    const load = vi.fn<PlaybackPlayerPort['load']>(async (_item, _host, signal) => {
      const destroy = vi.fn();
      sessions.push({ signal, destroy });
      return { destroy };
    });
    await renderProvider({ playerPort: { load } });

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await act(async () => {
        await currentAuthority().start(cycle % 2 === 0 ? ITEM_A : ITEM_B);
        await Promise.resolve();
      });
      expect(container.querySelectorAll('.playback-player-surface')).toHaveLength(1);
      act(() => currentAuthority().reset());
      expect(currentAuthority().state.phase).toBe('idle');
    }

    expect(load).toHaveBeenCalledTimes(12);
    expect(sessions).toHaveLength(12);
    for (const session of sessions) {
      expect(session.signal.aborted).toBe(true);
      expect(session.destroy).toHaveBeenCalledTimes(1);
    }
    expect(container.querySelectorAll('.playback-player-surface')).toHaveLength(1);
    expect(container.querySelector<HTMLElement>('.playback-player-surface')?.hidden).toBe(true);
  });

  it('ignores a burst of stale native callbacks after a newer request wins and after reset', async () => {
    const callbacks = new Map<string, PlaybackPlayerCallbacks>();
    const load = vi.fn<PlaybackPlayerPort['load']>(async (item, _host, _signal, events) => {
      callbacks.set(item.id, events);
      return { destroy: vi.fn() };
    });
    await renderProvider({ playerPort: { load }, requestIds: ['old-request', 'new-request'] });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });
    act(() => callbacks.get(ITEM_A.id)!.onReady());
    expect(currentAuthority().state.phase).toBe('paused');

    await act(async () => {
      await currentAuthority().start(ITEM_B);
      await Promise.resolve();
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'loading', requestId: 'new-request', item: { id: ITEM_B.id } });

    act(() => {
      const stale = callbacks.get(ITEM_A.id)!;
      stale.onPlaying();
      stale.onPaused();
      stale.onEnded();
      stale.onError('stale provider error');
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'loading', requestId: 'new-request', item: { id: ITEM_B.id }, error: null });

    act(() => currentAuthority().reset());
    act(() => {
      const stale = callbacks.get(ITEM_B.id)!;
      stale.onReady();
      stale.onPlaying();
      stale.onPaused();
      stale.onEnded();
      stale.onError('late after reset');
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null, error: null });
  });

  it('serializes rapid preference writes and falls back to the newest successfully durable route when the latest save fails', async () => {
    let persisted: MediaPlaybackPreference = 'ask';
    const pending: Array<{
      value: MediaPlaybackPreference;
      resolve: (value: MediaPlaybackPreference) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const store: PlaybackPreferenceStore = {
      load: async () => persisted,
      save: (value) => new Promise<MediaPlaybackPreference>((resolve, reject) => {
        pending.push({ value, resolve, reject });
      }),
    };
    await renderProvider({ playerPort: { load: vi.fn<PlaybackPlayerPort['load']>() }, preferenceStore: store });

    let first!: Promise<MediaPlaybackPreference>;
    let second!: Promise<MediaPlaybackPreference>;
    act(() => {
      first = currentAuthority().setPreference('embedded');
      second = currentAuthority().setPreference('external');
    });
    expect(currentAuthority().preference).toBe('ask');
    expect(currentAuthority().preferenceStatus).toBe('saving');

    await act(async () => { await Promise.resolve(); });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.value).toBe('embedded');

    await act(async () => {
      persisted = 'embedded';
      pending[0]!.resolve('embedded');
      await first;
      await Promise.resolve();
    });
    expect(pending).toHaveLength(2);
    expect(pending[1]?.value).toBe('external');
    expect(currentAuthority().preference).toBe('ask');
    expect(currentAuthority().preferenceStatus).toBe('saving');

    await act(async () => {
      pending[1]!.reject(new Error('latest write failed'));
      await expect(second).rejects.toThrow('latest write failed');
    });

    expect(currentAuthority().preference).toBe('embedded');
    expect(currentAuthority().preferenceStatus).toBe('failed');
    expect(currentAuthority().preferenceError).toContain('last saved choice');
    expect(persisted).toBe('embedded');
  });
});
