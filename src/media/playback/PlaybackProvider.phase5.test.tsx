// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  embedUrl: 'https://hostile.example/ignored',
  apiDataFetchedAt: NOW - 1_000,
  intent: 'listen',
};

const css = readFileSync(resolve(process.cwd(), 'src/media/playback/player-host.css'), 'utf8');
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

    await act(async () => {
      await authority!.start(ITEM);
      await Promise.resolve();
    });
    expect(authority!.state.phase).toBe('loading');
    expect(container.querySelector<HTMLButtonElement>('.playback-player-close')).not.toBeNull();

    act(() => container.querySelector<HTMLButtonElement>('.playback-player-close')!.click());
    expect(authority!.state).toMatchObject({ phase: 'idle', requestId: null, item: null });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the close affordance outside the provider iframe host', async () => {
    const playerPort: PlaybackPlayerPort = { load: async () => ({ destroy: vi.fn() }) };
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
      await authority!.start(ITEM);
      await Promise.resolve();
    });
    const surface = container.querySelector('.playback-player-surface')!;
    const host = surface.querySelector('.playback-player-host')!;
    expect(surface.querySelector('.playback-player-close')).not.toBeNull();
    expect(host.querySelector('.playback-player-close')).toBeNull();
  });

  it('enforces fixed viewport placement below the sidebar layer and a 200px player minimum', () => {
    expect(css).toMatch(/\.playback-player-surface\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.playback-player-surface\s*\{[^}]*z-index:\s*35/s);
    expect(css).toMatch(/\.playback-player-host\s*\{[^}]*min-height:\s*200px/s);
    expect(css).toMatch(/\.playback-player-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
  });
});
