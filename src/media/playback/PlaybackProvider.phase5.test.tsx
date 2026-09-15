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
import type { PlaybackPlayerPort } from './player';
import type { PlaybackReadinessPort } from './readiness';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;
const ITEM: MediaItem = {
  provider: 'youtube',
  id: 'a1B2c3D4e5F',
  kind: 'video',
  title: 'Phase 5 Track',
  channel: 'Player Channel',
  thumbnail: { url: 'https://i.ytimg.com/vi/a1B2c3D4e5F/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
  apiDataFetchedAt: NOW - 1_000,
  intent: 'listen',
};

let container: HTMLDivElement;
let root: Root;
let authority: PlaybackAuthority | null;

const preferenceStore: PlaybackPreferenceStore = {
  load: async () => 'embedded',
  save: async (value) => value,
};
const readinessPort: PlaybackReadinessPort = { check: async () => ({ status: 'ready' }) };

function Probe() {
  const current = usePlaybackAuthority();
  useEffect(() => { authority = current; }, [current]);
  return null;
}

function currentAuthority(): PlaybackAuthority {
  if (!authority) throw new Error('Playback authority probe has not mounted.');
  return authority;
}

async function renderProvider(playerPort: PlaybackPlayerPort): Promise<void> {
  await act(async () => {
    root.render(
      <PlaybackProvider
        preferenceStore={preferenceStore}
        readinessPort={readinessPort}
        playerPort={playerPort}
        requestIdFactory={() => 'request-a'}
        now={() => NOW}
      >
        <Probe />
      </PlaybackProvider>,
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  authority = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Phase 5 global player surface', () => {
  it('close uses the existing reset authority and destroys the one player session', async () => {
    const destroy = vi.fn();
    const playerPort: PlaybackPlayerPort = {
      load: async () => ({ destroy }),
    };
    await renderProvider(playerPort);

    await act(async () => {
      await currentAuthority().start(ITEM);
      await Promise.resolve();
    });
    expect(currentAuthority().state.phase).toBe('loading');
    const close = container.querySelector<HTMLButtonElement>('.playback-player-close');
    expect(close).not.toBeNull();

    act(() => close!.click());
    expect(currentAuthority().state).toMatchObject({ phase: 'idle', requestId: null, item: null });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the close affordance outside the provider iframe host', async () => {
    const playerPort: PlaybackPlayerPort = { load: async () => ({ destroy: vi.fn() }) };
    await renderProvider(playerPort);

    await act(async () => {
      await currentAuthority().start(ITEM);
      await Promise.resolve();
    });

    const surface = container.querySelector('.playback-player-surface');
    expect(surface).not.toBeNull();
    const host = surface!.querySelector('.playback-player-host');
    expect(host).not.toBeNull();
    expect(surface!.querySelector('.playback-player-close')).not.toBeNull();
    expect(host!.querySelector('.playback-player-close')).toBeNull();
  });
});
