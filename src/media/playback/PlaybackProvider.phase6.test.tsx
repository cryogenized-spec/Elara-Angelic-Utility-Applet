// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaPlaybackPreference } from '../../domain/playback';
import {
  PlaybackProvider,
  usePlaybackAuthority,
  type PlaybackAuthority,
  type PlaybackPreferenceStore,
} from './PlaybackProvider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let authority: PlaybackAuthority | null;

function Probe() {
  const current = usePlaybackAuthority();
  useEffect(() => { authority = current; }, [current]);
  return <output data-preference={current.preference} data-status={current.preferenceStatus} />;
}

function currentAuthority(): PlaybackAuthority {
  if (!authority) throw new Error('Playback authority probe has not mounted.');
  return authority;
}

async function renderProvider(store: PlaybackPreferenceStore): Promise<void> {
  await act(async () => {
    root.render(<PlaybackProvider preferenceStore={store}><Probe /></PlaybackProvider>);
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe('Phase 6 playback preference UX semantics', () => {
  it('distinguishes initial loading from saving and keeps the last durable route active until save succeeds', async () => {
    let persisted: MediaPlaybackPreference = 'external';
    let resolveSave!: (value: MediaPlaybackPreference) => void;
    const store: PlaybackPreferenceStore = {
      load: async () => persisted,
      save: (value) => new Promise<MediaPlaybackPreference>((resolve) => {
        resolveSave = (saved) => {
          persisted = saved;
          resolve(saved);
        };
        expect(value).toBe('embedded');
      }),
    };

    await renderProvider(store);
    expect(currentAuthority().preference).toBe('external');
    expect(currentAuthority().preferenceStatus).toBe('ready');

    let pending!: Promise<MediaPlaybackPreference>;
    act(() => { pending = currentAuthority().setPreference('embedded'); });
    expect(currentAuthority().preference).toBe('external');
    expect(currentAuthority().preferenceStatus).toBe('saving');

    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      resolveSave('embedded');
      await pending;
    });
    expect(currentAuthority().preference).toBe('embedded');
    expect(currentAuthority().preferenceStatus).toBe('ready');
    expect(persisted).toBe('embedded');
  });

  it('keeps the last durable route after a failed save instead of inventing Ask', async () => {
    const store: PlaybackPreferenceStore = {
      load: async () => 'external',
      save: async () => { throw new Error('write failed'); },
    };
    await renderProvider(store);

    await act(async () => {
      await expect(currentAuthority().setPreference('embedded')).rejects.toThrow('write failed');
    });

    expect(currentAuthority().preference).toBe('external');
    expect(currentAuthority().preferenceStatus).toBe('failed');
    expect(currentAuthority().preferenceError).toContain('last saved choice');
  });
});
