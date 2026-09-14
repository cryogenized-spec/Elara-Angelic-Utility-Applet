// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_API_DATA_MAX_AGE_MS, type MediaItem } from '../../domain/media';
import type { MediaPlaybackPreference } from '../../domain/playback';
import {
  PlaybackProvider,
  usePlaybackAuthority,
  type PlaybackAuthority,
  type PlaybackPreferenceStore,
} from './PlaybackProvider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;
const freshItem: MediaItem = {
  provider: 'youtube',
  id: 'phase2ProviderVideo',
  kind: 'video',
  title: 'Provider Track',
  channel: 'Provider Channel',
  thumbnail: { url: 'https://i.ytimg.com/vi/phase2ProviderVideo/hqdefault.jpg', width: 480, height: 360 },
  webUrl: 'https://www.youtube.com/watch?v=phase2ProviderVideo',
  embedUrl: 'https://www.youtube-nocookie.com/embed/phase2ProviderVideo',
  apiDataFetchedAt: NOW - 1_000,
  intent: 'listen',
};

let container: HTMLDivElement;
let root: Root;
let authority: PlaybackAuthority | null;

function Probe() {
  authority = usePlaybackAuthority();
  return <output data-phase={authority.state.phase} data-preference={authority.preference} data-status={authority.preferenceStatus} />;
}

function memoryStore(initial: MediaPlaybackPreference = 'ask'): PlaybackPreferenceStore & { current: MediaPlaybackPreference } {
  const store = {
    current: initial,
    async load() { return store.current; },
    async save(value: MediaPlaybackPreference) { store.current = value; return value; },
  };
  return store;
}

async function renderProvider(store: PlaybackPreferenceStore, requestIds: string[] = ['request-a', 'request-b']): Promise<void> {
  let index = 0;
  await act(async () => {
    root.render(
      <PlaybackProvider
        preferenceStore={store}
        requestIdFactory={() => requestIds[index++] ?? `request-${index}`}
        now={() => NOW}
      >
        <Probe />
      </PlaybackProvider>,
    );
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
  vi.restoreAllMocks();
});

describe('Phase 2 PlaybackProvider authority', () => {
  it('loads the durable preference while creating no player DOM or media request side effects', async () => {
    const store = memoryStore('external');
    await renderProvider(store);
    expect(authority?.preference).toBe('external');
    expect(authority?.preferenceStatus).toBe('ready');
    expect(authority?.state).toMatchObject({ phase: 'idle', requestId: null, item: null });
    expect(container.querySelector('iframe, audio, video')).toBeNull();
  });

  it('fails preference loading safely back to ask', async () => {
    const store: PlaybackPreferenceStore = {
      load: async () => { throw new Error('storage body that should not surface'); },
      save: async (value) => value,
    };
    await renderProvider(store);
    expect(authority?.preference).toBe('ask');
    expect(authority?.preferenceStatus).toBe('failed');
    expect(authority?.preferenceError).toBe('Could not load the media playback preference. Ask each time will be used.');
    expect(authority?.preferenceError).not.toContain('storage body');
  });

  it('accepts fresh selections, rejects stale/future ones, and never replaces a valid current selection on rejection', async () => {
    await renderProvider(memoryStore());
    let requestId: string | null = null;
    act(() => { requestId = authority!.select(freshItem); });
    expect(requestId).toBe('request-a');
    expect(authority?.state).toMatchObject({ phase: 'requested', requestId: 'request-a' });

    const stale = { ...freshItem, id: 'stale', apiDataFetchedAt: NOW - MEDIA_API_DATA_MAX_AGE_MS, webUrl: 'https://www.youtube.com/watch?v=stale', embedUrl: 'https://www.youtube-nocookie.com/embed/stale' };
    const future = { ...freshItem, id: 'future', apiDataFetchedAt: NOW + 1, webUrl: 'https://www.youtube.com/watch?v=future', embedUrl: 'https://www.youtube-nocookie.com/embed/future' };
    expect(authority!.select(stale)).toBeNull();
    expect(authority!.select(future)).toBeNull();
    expect(authority?.state).toMatchObject({ phase: 'requested', requestId: 'request-a', item: { id: freshItem.id } });
  });

  it('elects the newest selection and ignores every late lifecycle callback from its predecessor', async () => {
    await renderProvider(memoryStore());
    act(() => {
      authority!.select(freshItem);
      authority!.beginCheck('request-a');
    });
    const second = { ...freshItem, id: 'phase2ProviderVideoB', title: 'B', webUrl: 'https://www.youtube.com/watch?v=phase2ProviderVideoB', embedUrl: 'https://www.youtube-nocookie.com/embed/phase2ProviderVideoB' };
    act(() => { authority!.select(second); });
    expect(authority?.state).toMatchObject({ phase: 'requested', requestId: 'request-b', item: { id: second.id } });

    act(() => {
      authority!.markReady('request-a');
      authority!.beginLoad('request-a');
      authority!.markPlaying('request-a');
      authority!.markPaused('request-a');
      authority!.markEnded('request-a');
      authority!.markFailed('request-a', 'late');
    });
    expect(authority?.state).toMatchObject({ phase: 'requested', requestId: 'request-b', error: null });
  });

  it('serializes rapid preference writes and keeps the last durable value when the newest write fails', async () => {
    let persisted: MediaPlaybackPreference = 'ask';
    const resolvers: Array<{ value: MediaPlaybackPreference; resolve: (value: MediaPlaybackPreference) => void; reject: (reason: unknown) => void }> = [];
    const store: PlaybackPreferenceStore = {
      load: async () => persisted,
      save: (value) => new Promise<MediaPlaybackPreference>((resolve, reject) => {
        resolvers.push({ value, resolve, reject });
      }),
    };
    await renderProvider(store);

    let first!: Promise<MediaPlaybackPreference>;
    let second!: Promise<MediaPlaybackPreference>;
    act(() => {
      first = authority!.setPreference('external');
      second = authority!.setPreference('embedded');
    });
    await act(async () => { await Promise.resolve(); });
    expect(resolvers.map((entry) => entry.value)).toEqual(['external']);

    persisted = 'external';
    await act(async () => {
      resolvers[0].resolve('external');
      await first;
      await Promise.resolve();
    });
    expect(resolvers.map((entry) => entry.value)).toEqual(['external', 'embedded']);

    await act(async () => {
      resolvers[1].reject(new Error('write failed'));
      await expect(second).rejects.toThrow('write failed');
    });
    expect(authority?.preference).toBe('external');
    expect(authority?.preferenceStatus).toBe('failed');
    expect(authority?.preferenceError).toContain('last saved choice');
  });

  it('does not let a late initial load overwrite a newer user preference', async () => {
    let resolveLoad!: (value: MediaPlaybackPreference) => void;
    const store = memoryStore();
    store.load = () => new Promise<MediaPlaybackPreference>((resolve) => { resolveLoad = resolve; });
    await act(async () => {
      root.render(<PlaybackProvider preferenceStore={store} requestIdFactory={() => 'request-a'} now={() => NOW}><Probe /></PlaybackProvider>);
      await Promise.resolve();
    });

    await act(async () => { await authority!.setPreference('external'); });
    expect(authority?.preference).toBe('external');
    act(() => resolveLoad('embedded'));
    await act(async () => { await Promise.resolve(); });
    expect(authority?.preference).toBe('external');
  });

  it('persists only preference across authority remount; selected playback state disappears', async () => {
    const store = memoryStore();
    await renderProvider(store);
    await act(async () => { await authority!.setPreference('external'); });
    act(() => { authority!.select(freshItem); });
    expect(authority?.state.phase).toBe('requested');

    act(() => root.unmount());
    root = createRoot(container);
    authority = null;
    await renderProvider(store, ['request-c']);
    expect(authority?.preference).toBe('external');
    expect(authority?.state).toMatchObject({ phase: 'idle', requestId: null, item: null, error: null });
  });

  it('rejects a second nested PlaybackProvider instead of creating competing playback state', async () => {
    const store = memoryStore();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(act(async () => {
      root.render(
        <PlaybackProvider preferenceStore={store}>
          <PlaybackProvider preferenceStore={store}><Probe /></PlaybackProvider>
        </PlaybackProvider>,
      );
      await Promise.resolve();
    })).rejects.toThrow('one global playback authority is required');
    expect(errorSpy).toHaveBeenCalled();
  });
});
