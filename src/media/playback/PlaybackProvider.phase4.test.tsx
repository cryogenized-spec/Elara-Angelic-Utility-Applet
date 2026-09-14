// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../domain/media';
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
  title: 'Track A',
  channel: 'Channel A',
  thumbnail: { url: 'https://i.ytimg.com/vi/a1B2c3D4e5F/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
  embedUrl: 'https://hostile.example/embed/not-authority',
  apiDataFetchedAt: NOW - 1_000,
  intent: 'listen',
};
const ITEM_B: MediaItem = {
  ...ITEM_A,
  id: 'z9Y8x7W6v5U',
  title: 'Track B',
  webUrl: 'https://www.youtube.com/watch?v=z9Y8x7W6v5U',
};

let container: HTMLDivElement;
let root: Root;
let authority: PlaybackAuthority | null;

function Probe() {
  const current = usePlaybackAuthority();
  useEffect(() => { authority = current; }, [current]);
  return <output data-phase={current.state.phase} data-request-id={current.state.requestId ?? ''} />;
}

function currentAuthority(): PlaybackAuthority {
  if (!authority) throw new Error('Playback authority probe has not mounted.');
  return authority;
}

function memoryStore(): PlaybackPreferenceStore {
  return {
    load: async () => 'ask',
    save: async (value) => value,
  };
}

const readyPort: PlaybackReadinessPort = {
  check: async () => ({ status: 'ready' }),
};

async function renderProvider(
  playerPort: PlaybackPlayerPort,
  readinessPort: PlaybackReadinessPort = readyPort,
  requestIds = ['request-a', 'request-b', 'request-c'],
): Promise<void> {
  let index = 0;
  await act(async () => {
    root.render(
      <PlaybackProvider
        preferenceStore={memoryStore()}
        readinessPort={readinessPort}
        playerPort={playerPort}
        requestIdFactory={() => requestIds[index++] ?? `request-${index}`}
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

describe('Phase 4 PlaybackProvider player orchestration', () => {
  it('keeps prepare readiness-only and does not create a player as a side effect', async () => {
    const load = vi.fn<PlaybackPlayerPort['load']>();
    const playerPort: PlaybackPlayerPort = { load };
    await renderProvider(playerPort);

    await act(async () => {
      await currentAuthority().prepare(ITEM_A);
    });

    expect(currentAuthority().state).toMatchObject({ phase: 'ready', requestId: 'request-a' });
    expect(load).not.toHaveBeenCalled();
    expect(container.querySelector('iframe, audio, video')).toBeNull();
    expect(container.querySelector<HTMLElement>('.playback-player-surface')?.hidden).toBe(true);
  });

  it('uses the existing loading/player phases for one global player session', async () => {
    let events!: PlaybackPlayerCallbacks;
    const destroy = vi.fn();
    const load = vi.fn<PlaybackPlayerPort['load']>(async (_item, _host, _signal, callbacks) => {
      events = callbacks;
      return { destroy };
    });
    await renderProvider({ load });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(currentAuthority().state).toMatchObject({ phase: 'loading', requestId: 'request-a' });
    expect(container.querySelector<HTMLElement>('.playback-player-surface')?.hidden).toBe(false);

    act(() => events.onReady());
    expect(currentAuthority().state.phase).toBe('paused');
    act(() => events.onPlaying());
    expect(currentAuthority().state.phase).toBe('playing');
    act(() => events.onPaused());
    expect(currentAuthority().state.phase).toBe('paused');
    act(() => events.onEnded());
    expect(currentAuthority().state.phase).toBe('ended');
    act(() => events.onPlaying());
    expect(currentAuthority().state.phase).toBe('playing');
  });

  it('tears down the old player when a newer valid selection wins', async () => {
    const sessions = new Map<string, {
      signal: AbortSignal;
      events: PlaybackPlayerCallbacks;
      destroy: ReturnType<typeof vi.fn>;
    }>();
    const load = vi.fn<PlaybackPlayerPort['load']>(async (item, _host, signal, callbacks) => {
      const destroy = vi.fn();
      sessions.set(item.id, { signal, events: callbacks, destroy });
      return { destroy };
    });
    await renderProvider({ load });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });
    act(() => sessions.get(ITEM_A.id)!.events.onReady());
    expect(currentAuthority().state.phase).toBe('paused');

    await act(async () => {
      await currentAuthority().start(ITEM_B);
      await Promise.resolve();
    });

    expect(sessions.get(ITEM_A.id)?.signal.aborted).toBe(true);
    expect(sessions.get(ITEM_A.id)?.destroy).toHaveBeenCalledTimes(1);
    expect(currentAuthority().state).toMatchObject({ phase: 'loading', requestId: 'request-b', item: { id: ITEM_B.id } });

    act(() => sessions.get(ITEM_A.id)!.events.onEnded());
    expect(currentAuthority().state).toMatchObject({ phase: 'loading', requestId: 'request-b' });
  });

  it('reset aborts and destroys the elected player session', async () => {
    let signal!: AbortSignal;
    const destroy = vi.fn();
    const load = vi.fn<PlaybackPlayerPort['load']>(async (_item, _host, currentSignal) => {
      signal = currentSignal;
      return { destroy };
    });
    await renderProvider({ load });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
    });
    act(() => currentAuthority().reset());

    expect(signal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null });
  });

  it('never invokes the player port when readiness blocks internal playback', async () => {
    const load = vi.fn<PlaybackPlayerPort['load']>();
    const blocked: PlaybackReadinessPort = {
      check: async () => ({
        status: 'blocked',
        reason: 'made-for-kids',
        message: 'This Made for Kids video opens externally.',
      }),
    };
    await renderProvider({ load }, blocked);

    await act(async () => {
      await currentAuthority().start(ITEM_A);
    });

    expect(load).not.toHaveBeenCalled();
    expect(currentAuthority().state).toMatchObject({
      phase: 'failed',
      requestId: 'request-a',
      item: { id: ITEM_A.id, webUrl: ITEM_A.webUrl },
    });
  });

  it('fails through the existing reducer when the player adapter cannot load', async () => {
    const load = vi.fn<PlaybackPlayerPort['load']>(async () => {
      throw new Error('raw provider detail that must not escape');
    });
    await renderProvider({ load });

    await act(async () => {
      await currentAuthority().start(ITEM_A);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(currentAuthority().state).toMatchObject({
      phase: 'failed',
      requestId: 'request-a',
      error: 'The embedded YouTube player could not be loaded.',
    });
  });
});
