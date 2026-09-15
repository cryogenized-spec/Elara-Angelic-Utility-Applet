// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../../domain/media';
import type { PlaybackReadinessDecision } from '../../domain/playback';
import {
  PlaybackProvider,
  usePlaybackAuthority,
  type PlaybackAuthority,
  type PlaybackPreferenceStore,
} from './PlaybackProvider';
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

async function renderProvider(readinessPort: PlaybackReadinessPort, requestIds = ['request-a', 'request-b']): Promise<void> {
  let index = 0;
  await act(async () => {
    root.render(
      <PlaybackProvider
        preferenceStore={memoryStore()}
        readinessPort={readinessPort}
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

describe('Phase 3 PlaybackProvider readiness orchestration', () => {
  it('uses the existing request lifecycle for readiness and creates no player DOM', async () => {
    let resolve!: (decision: PlaybackReadinessDecision) => void;
    const port: PlaybackReadinessPort = {
      check: () => new Promise((done) => { resolve = done; }),
    };
    await renderProvider(port);

    let preparation!: ReturnType<PlaybackAuthority['prepare']>;
    await act(async () => {
      preparation = currentAuthority().prepare(ITEM_A);
      await Promise.resolve();
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'checking', requestId: 'request-a', item: { id: ITEM_A.id } });
    expect(container.querySelector('iframe, audio, video')).toBeNull();

    await act(async () => {
      resolve({ status: 'ready' });
      await expect(preparation).resolves.toEqual({ requestId: 'request-a', decision: { status: 'ready' } });
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'ready', requestId: 'request-a', error: null });
    expect(container.querySelector('iframe, audio, video')).toBeNull();
  });

  it('keeps the newest selection authoritative and aborts superseded readiness work', async () => {
    const pending = new Map<string, { signal: AbortSignal; resolve: (decision: PlaybackReadinessDecision) => void }>();
    const port: PlaybackReadinessPort = {
      check: (item, signal) => new Promise((resolve) => { pending.set(item.id, { signal, resolve }); }),
    };
    await renderProvider(port);

    let first!: ReturnType<PlaybackAuthority['prepare']>;
    let second!: ReturnType<PlaybackAuthority['prepare']>;
    await act(async () => {
      first = currentAuthority().prepare(ITEM_A);
      await Promise.resolve();
    });
    expect(pending.get(ITEM_A.id)?.signal.aborted).toBe(false);

    await act(async () => {
      second = currentAuthority().prepare(ITEM_B);
      await Promise.resolve();
    });
    expect(pending.get(ITEM_A.id)?.signal.aborted).toBe(true);
    expect(currentAuthority().state).toMatchObject({ phase: 'checking', requestId: 'request-b', item: { id: ITEM_B.id } });

    await act(async () => {
      pending.get(ITEM_A.id)!.resolve({ status: 'ready' });
      await expect(first).resolves.toBeNull();
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'checking', requestId: 'request-b' });

    await act(async () => {
      pending.get(ITEM_B.id)!.resolve({ status: 'ready' });
      await expect(second).resolves.toEqual({ requestId: 'request-b', decision: { status: 'ready' } });
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'ready', requestId: 'request-b', item: { id: ITEM_B.id } });
  });

  it('maps an internally blocked decision onto the existing failed phase without damaging the selected card', async () => {
    const port: PlaybackReadinessPort = {
      check: async () => ({
        status: 'blocked',
        reason: 'not-embeddable',
        message: 'This YouTube video does not allow embedded playback.',
      }),
    };
    await renderProvider(port);

    await act(async () => {
      await currentAuthority().prepare(ITEM_A);
    });

    expect(currentAuthority().state).toMatchObject({
      phase: 'failed',
      requestId: 'request-a',
      item: { id: ITEM_A.id, webUrl: ITEM_A.webUrl },
      error: 'This YouTube video does not allow embedded playback.',
    });
  });

  it('reset aborts readiness and a late provider answer cannot resurrect playback state', async () => {
    let signal!: AbortSignal;
    let resolve!: (decision: PlaybackReadinessDecision) => void;
    const port: PlaybackReadinessPort = {
      check: (_item, currentSignal) => {
        signal = currentSignal;
        return new Promise((done) => { resolve = done; });
      },
    };
    await renderProvider(port);

    let preparation!: ReturnType<PlaybackAuthority['prepare']>;
    await act(async () => {
      preparation = currentAuthority().prepare(ITEM_A);
      await Promise.resolve();
    });

    act(() => currentAuthority().reset());
    expect(signal.aborted).toBe(true);
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null });

    await act(async () => {
      resolve({ status: 'ready' });
      await expect(preparation).resolves.toBeNull();
    });
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null });
  });

  it('rejected stale selections never cancel a currently valid readiness request', async () => {
    let signal!: AbortSignal;
    let resolve!: (decision: PlaybackReadinessDecision) => void;
    const port: PlaybackReadinessPort = {
      check: (_item, currentSignal) => {
        signal = currentSignal;
        return new Promise((done) => { resolve = done; });
      },
    };
    await renderProvider(port);

    let preparation!: ReturnType<PlaybackAuthority['prepare']>;
    await act(async () => {
      preparation = currentAuthority().prepare(ITEM_A);
      await Promise.resolve();
    });

    const stale = { ...ITEM_B, apiDataFetchedAt: NOW - (30 * 24 * 60 * 60 * 1000) };
    expect(currentAuthority().select(stale)).toBeNull();
    expect(signal.aborted).toBe(false);

    await act(async () => {
      resolve({ status: 'ready' });
      await preparation;
    });
    expect(currentAuthority().state.phase).toBe('ready');
  });
});
