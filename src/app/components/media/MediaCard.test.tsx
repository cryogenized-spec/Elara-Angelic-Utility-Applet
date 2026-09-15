// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackAuthority } from '../../../media/playback/PlaybackProvider';
import type { MediaItem } from '../../../domain/media';

const playbackHolder = vi.hoisted((): { current: PlaybackAuthority | null } => ({ current: null }));
vi.mock('../../../media/playback/PlaybackProvider', () => ({
  usePlaybackAuthority: (): PlaybackAuthority => {
    const current = playbackHolder.current;
    if (!current) throw new Error('Playback authority test fixture is not installed.');
    return current;
  },
}));

import { MediaCard } from './MediaCard';
import { MessageMedia } from './MessageMedia';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;
const cssSheet = readFileSync(resolve(process.cwd(), 'src/app/components/media/media-card.css'), 'utf8');

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    provider: 'youtube',
    id: 'abc123',
    kind: 'video',
    title: 'Dark Ambient Mix — 3 Hours',
    channel: 'Ambient Channel',
    publishedAt: '2024-05-01T00:00:00Z',
    thumbnail: { url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg', width: 480, height: 360 },
    webUrl: 'https://www.youtube.com/watch?v=abc123',
    embedUrl: 'https://www.youtube-nocookie.com/embed/abc123?autoplay=0',
    apiDataFetchedAt: NOW - 1_000,
    ...overrides,
  };
}

function playbackAuthority(overrides: Partial<PlaybackAuthority> = {}): PlaybackAuthority {
  return {
    state: { phase: 'idle', requestId: null, item: null, error: null },
    preference: 'external',
    preferenceStatus: 'ready',
    preferenceError: null,
    setPreference: vi.fn<PlaybackAuthority['setPreference']>(async (value) => value),
    select: vi.fn<PlaybackAuthority['select']>(() => null),
    prepare: vi.fn<PlaybackAuthority['prepare']>(async () => null),
    start: vi.fn<PlaybackAuthority['start']>(async () => null),
    beginCheck: vi.fn<PlaybackAuthority['beginCheck']>(),
    markReady: vi.fn<PlaybackAuthority['markReady']>(),
    beginLoad: vi.fn<PlaybackAuthority['beginLoad']>(),
    markPlaying: vi.fn<PlaybackAuthority['markPlaying']>(),
    markPaused: vi.fn<PlaybackAuthority['markPaused']>(),
    markEnded: vi.fn<PlaybackAuthority['markEnded']>(),
    markFailed: vi.fn<PlaybackAuthority['markFailed']>(),
    reset: vi.fn<PlaybackAuthority['reset']>(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  playbackHolder.current = playbackAuthority();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('MediaCard external route', () => {
  it('preserves the canonical watch link and creates no embedded player', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<video');
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(html).toContain('target="_blank"');
  });

  it('never enables autoplay anywhere in card output', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).not.toContain('autoplay=1');
    expect(html).not.toContain('autoplay=0');
    expect(html).not.toMatch(/<iframe|<video|<audio/i);
  });

  it('opens the link safely in a new tab', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} />)).toContain('rel="noreferrer noopener"');
  });

  it('keeps the entire external card as one link control', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} platform={{ isAndroid: true }} />);
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
  });

  it('keeps listen and watch on the same canonical provider destination', () => {
    const listen = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={{ isAndroid: false }} />);
    const watch = renderToStaticMarkup(<MediaCard item={item({ intent: 'watch' })} platform={{ isAndroid: false }} />);
    expect(listen).toContain('youtube.com/watch?v=abc123');
    expect(listen).not.toContain('music.youtube.com');
    expect(watch).toContain('youtube.com/watch?v=abc123');
    expect(listen).toContain('>Listen');
    expect(watch).toContain('>Watch');
  });

  it('hands the same canonical URL through an unpinned Android intent', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={{ isAndroid: true }} />);
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(html).toContain('intent://www.youtube.com/watch?v=abc123#Intent;');
    expect(html).toContain('browser_fallback_url');
    expect(html).not.toContain(';package=');
  });
});

describe('MediaCard routed playback', () => {
  const playable = () => item({
    id: 'a1B2c3D4e5F',
    webUrl: 'https://www.youtube.com/watch?v=a1B2c3D4e5F',
    embedUrl: 'https://hostile.example/ignored',
  });

  it('routes embedded preference only through PlaybackProvider.start()', async () => {
    const start = vi.fn<PlaybackAuthority['start']>(async () => null);
    playbackHolder.current = playbackAuthority({ preference: 'embedded', start });
    const selected = playable();

    await act(async () => { root.render(<MediaCard item={selected} platform={{ isAndroid: false }} />); });
    const button = container.querySelector<HTMLButtonElement>('.media-card__primary');
    expect(button).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();

    await act(async () => { button!.click(); await Promise.resolve(); });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(selected);
  });

  it('uses ask as disclosure between the same embedded and external routes', async () => {
    const start = vi.fn<PlaybackAuthority['start']>(async () => null);
    playbackHolder.current = playbackAuthority({ preference: 'ask', start });
    const selected = playable();

    await act(async () => { root.render(<MediaCard item={selected} platform={{ isAndroid: false }} />); });
    const primary = container.querySelector<HTMLButtonElement>('.media-card__primary')!;
    expect(primary.getAttribute('aria-expanded')).toBe('false');

    act(() => primary.click());
    expect(primary.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Play here');
    const external = container.querySelector<HTMLAnchorElement>('.media-card__choice--external');
    expect(external?.href).toBe('https://www.youtube.com/watch?v=a1B2c3D4e5F');

    const playHere = [...container.querySelectorAll<HTMLButtonElement>('.media-card__choice')]
      .find((button) => button.textContent === 'Play here');
    await act(async () => { playHere!.click(); await Promise.resolve(); });
    expect(start).toHaveBeenCalledWith(selected);
    expect(container.querySelector('.media-card__chooser')).toBeNull();
  });

  it('uses the provider default ask route during initial preference loading', async () => {
    playbackHolder.current = playbackAuthority({ preference: 'ask', preferenceStatus: 'loading' });
    await act(async () => { root.render(<MediaCard item={playable()} platform={{ isAndroid: false }} />); });
    expect(container.textContent).toContain('Choose playback');
    expect(container.querySelector('.media-card__primary')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the last durable route active while a new preference is saving', async () => {
    playbackHolder.current = playbackAuthority({ preference: 'embedded', preferenceStatus: 'saving' });
    await act(async () => { root.render(<MediaCard item={playable()} platform={{ isAndroid: false }} />); });
    expect(container.textContent).toContain('Play here');
    expect(container.querySelector('.media-card__primary')?.getAttribute('aria-expanded')).toBeNull();
    expect(container.querySelector('.media-card__chooser')).toBeNull();
  });

  it('keeps the retained external route active after a failed preference save', () => {
    playbackHolder.current = playbackAuthority({ preference: 'external', preferenceStatus: 'failed' });
    const html = renderToStaticMarkup(<MediaCard item={playable()} platform={{ isAndroid: false }} />);
    expect(html).toContain('href="https://www.youtube.com/watch?v=a1B2c3D4e5F"');
    expect(html).not.toContain('Choose playback');
  });

  it('reflects current player state from the global authority and does not start a second embedded request', async () => {
    const selected = playable();
    const start = vi.fn<PlaybackAuthority['start']>(async () => null);
    playbackHolder.current = playbackAuthority({
      preference: 'embedded',
      start,
      state: { phase: 'playing', requestId: 'request-a', item: selected, error: null },
    });

    await act(async () => { root.render(<MediaCard item={selected} />); });
    const button = container.querySelector<HTMLButtonElement>('.media-card__primary')!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain('Playing here');
    act(() => button.click());
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps Open YouTube available in ask mode while the same item is already playing', async () => {
    const selected = playable();
    const start = vi.fn<PlaybackAuthority['start']>(async () => null);
    playbackHolder.current = playbackAuthority({
      preference: 'ask',
      start,
      state: { phase: 'playing', requestId: 'request-a', item: selected, error: null },
    });

    await act(async () => { root.render(<MediaCard item={selected} platform={{ isAndroid: false }} />); });
    const primary = container.querySelector<HTMLButtonElement>('.media-card__primary')!;
    expect(primary.disabled).toBe(false);
    expect(container.textContent).toContain('Playing here');
    act(() => primary.click());

    const playHere = [...container.querySelectorAll<HTMLButtonElement>('.media-card__choice')]
      .find((button) => button.textContent === 'Play here')!;
    expect(playHere.disabled).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>('.media-card__choice--external')?.href)
      .toBe('https://www.youtube.com/watch?v=a1B2c3D4e5F');
    act(() => playHere.click());
    expect(start).not.toHaveBeenCalled();
  });

  it('closes the ask chooser with Escape and restores focus to its primary control', async () => {
    playbackHolder.current = playbackAuthority({ preference: 'ask' });
    await act(async () => { root.render(<MediaCard item={playable()} platform={{ isAndroid: false }} />); });
    const primary = container.querySelector<HTMLButtonElement>('.media-card__primary')!;
    act(() => primary.click());
    expect(container.querySelector('.media-card__chooser')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('.media-card__choice')!.focus();
      container.querySelector<HTMLElement>('.media-card--routed')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('.media-card__chooser')).toBeNull();
    expect(document.activeElement).toBe(primary);
    expect(primary.getAttribute('aria-expanded')).toBe('false');
  });

  it('gives identical media cards distinct chooser ids', async () => {
    playbackHolder.current = playbackAuthority({ preference: 'ask' });
    const selected = playable();
    await act(async () => {
      root.render(<><MediaCard item={selected} /><MediaCard item={selected} /></>);
    });
    const controls = [...container.querySelectorAll<HTMLButtonElement>('.media-card__primary')]
      .map((button) => button.getAttribute('aria-controls'));
    expect(controls).toHaveLength(2);
    expect(controls[0]).toBeTruthy();
    expect(controls[1]).toBeTruthy();
    expect(controls[0]).not.toBe(controls[1]);
  });

  it('preserves the unpinned Android VIEW intent in the ask external choice', async () => {
    playbackHolder.current = playbackAuthority({ preference: 'ask' });
    await act(async () => { root.render(<MediaCard item={playable()} platform={{ isAndroid: true }} />); });
    act(() => container.querySelector<HTMLButtonElement>('.media-card__primary')!.click());
    const external = container.querySelector<HTMLAnchorElement>('.media-card__choice--external')!;
    expect(external.href).toBe('https://www.youtube.com/watch?v=a1B2c3D4e5F');
    const intent = external.dataset.intentHref ?? '';
    expect(intent).toContain('intent://www.youtube.com/watch?v=a1B2c3D4e5F#Intent;');
    expect(intent).toContain('action=android.intent.action.VIEW');
    expect(intent).toContain('browser_fallback_url');
    expect(intent).not.toContain(';package=');
  });

  it('shows the authority failure with a separately validated external fallback', async () => {
    const selected = playable();
    playbackHolder.current = playbackAuthority({
      preference: 'embedded',
      state: { phase: 'failed', requestId: 'request-a', item: selected, error: 'This video does not allow embedded playback.' },
    });

    await act(async () => { root.render(<MediaCard item={selected} platform={{ isAndroid: false }} />); });
    expect(container.textContent).toContain('This video does not allow embedded playback.');
    expect(container.querySelector<HTMLAnchorElement>('.media-card__fallback')?.href)
      .toBe('https://www.youtube.com/watch?v=a1B2c3D4e5F');
  });
});

describe('MediaCard trust and presentation', () => {
  it('defers the thumbnail and hides it from assistive tech', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="480"');
    expect(html).toContain('height="360"');
  });

  it('renders a placeholder instead of a broken image when there is no thumbnail', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ thumbnail: undefined })} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('media-card__thumb--empty');
  });

  it('visibly attributes the API result to YouTube without imitating a logo', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).toContain('media-card__source">Source: YouTube');
    expect(html).not.toContain('media-card__badge');
  });

  it.each(['external', 'embedded', 'ask'] as const)(
    'keeps unsafe/non-canonical persisted destinations inert even when preference=%s',
    (preference) => {
      playbackHolder.current = playbackAuthority({ preference });
      const html = renderToStaticMarkup(<MediaCard item={item({ webUrl: 'https://evil.example/watch?v=abc123' })} />);
      expect(html).toContain('media-card--unavailable');
      expect(html).toContain('>Unavailable<');
      expect(html).not.toMatch(/<a(?:\s|>)/);
      expect(html).not.toContain('<button');
      expect(html).not.toContain('href=');
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'http://www.youtube.com/watch?v=abc123',
    'https://evil.example/watch?v=abc123',
    'https://www.youtube.com/watch?v=abc123&t=42s',
    'not a url',
  ])('turns an unsafe or non-canonical destination into an inert card: %s', (webUrl) => {
    const html = renderToStaticMarkup(<MediaCard item={item({ webUrl })} />);
    expect(html).toContain('media-card--unavailable');
    expect(html).not.toContain('href=');
  });
});

describe('MessageMedia', () => {
  it('renders nothing when a message carries no media', () => {
    expect(renderToStaticMarkup(<MessageMedia items={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<MessageMedia items={[]} />)).toBe('');
  });

  it('loads cards lazily and renders every item without embedding per-card players', async () => {
    await act(async () => {
      root.render(<MessageMedia items={[
        item(),
        item({ id: 'def456', title: 'Second', webUrl: 'https://www.youtube.com/watch?v=def456' }),
      ]} />);
    });
    for (let attempt = 0; attempt < 40 && !container.querySelector('.media-card'); attempt += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    }
    expect(container.querySelectorAll('.media-card')).toHaveLength(2);
    expect(container.textContent).toContain('Dark Ambient Mix');
    expect(container.textContent).toContain('Second');
    expect(container.innerHTML).not.toContain('<iframe');
  });

  it('labels the group as resolved results', async () => {
    await act(async () => { root.render(<MessageMedia items={[item()]} />); });
    for (let attempt = 0; attempt < 40 && !container.querySelector('.media-card'); attempt += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    }
    expect(container.querySelector('.media-rail')?.getAttribute('aria-label')).toBe('Media results from YouTube');
  });
});

describe('MediaCard stylesheet contract', () => {
  it('reserves the thumbnail box at 16:9', () => {
    expect(cssSheet).toMatch(/\.media-card__thumb\s*\{[^}]*aspect-ratio:\s*16 \/ 9/s);
    expect(cssSheet).not.toMatch(/aspect-ratio:\s*4 \/ 3/);
  });

  it('keeps primary card and chooser actions thumb-sized', () => {
    expect(cssSheet).toMatch(/\.media-card__cta\s*\{[^}]*min-height:\s*44px/s);
    expect(cssSheet).toMatch(/\.media-card__choice,[\s\S]*\.media-card__fallback\s*\{[^}]*min-height:\s*44px/s);
  });

  it('visibly distinguishes disabled embedded choice while preserving external access', () => {
    expect(cssSheet).toMatch(/button\.media-card__choice:disabled\s*\{[^}]*cursor:\s*not-allowed[^}]*opacity:\s*\.55/s);
  });

  it('gives chooser and fallback actions a keyboard focus ring', () => {
    expect(cssSheet).toMatch(/\.media-card__choice:focus-visible,[\s\S]*\.media-card__fallback:focus-visible\s*\{/);
  });

  it('styles attribution as ordinary source text rather than an imitation badge', () => {
    expect(cssSheet).toMatch(/\.media-card__source\s*\{/);
    expect(cssSheet).not.toMatch(/\.media-card__badge\s*\{/);
  });

  it('makes unavailable cards visibly non-interactive', () => {
    expect(cssSheet).toMatch(/\.media-card--unavailable\s*\{[^}]*cursor:\s*default/s);
  });

  it('honours reduced-motion preferences', () => {
    expect(cssSheet).toMatch(/prefers-reduced-motion: reduce/);
  });
});
