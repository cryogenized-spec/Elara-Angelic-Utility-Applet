// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaCard } from './MediaCard';
import { MessageMedia } from './MessageMedia';
import type { MediaItem } from '../../../domain/media';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('MediaCard', () => {
  it('is a link to the canonical watch URL, not an embedded player', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<video');
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(html).toContain('target="_blank"');
  });

  it('never enables autoplay anywhere in its output', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).not.toContain('autoplay=1');
    expect(html).not.toContain('autoplay=0');
    expect(html).not.toMatch(/<iframe|<video|<audio/i);
  });

  it('opens the link safely in a new tab', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} />)).toContain('rel="noreferrer noopener"');
  });

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
    expect(html).toContain('Dark Ambient Mix');
  });

  it('omits the channel line when the provider did not return one', () => {
    expect(renderToStaticMarkup(<MediaCard item={item({ channel: undefined })} />)).not.toContain('media-card__channel');
  });

  it('visibly attributes the API result to YouTube', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);
    expect(html).toContain('media-card__badge">YouTube');
  });

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
    expect(html).toContain('>Unavailable<');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('data-intent-href');
  });
});

describe('MessageMedia', () => {
  it('renders nothing at all when a message carries no media', () => {
    expect(renderToStaticMarkup(<MessageMedia items={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<MessageMedia items={[]} />)).toBe('');
  });

  it('loads the card lazily and renders every item', async () => {
    await act(async () => {
      root.render(<MessageMedia items={[
        item(),
        item({ id: 'def456', title: 'Second', webUrl: 'https://www.youtube.com/watch?v=def456' }),
      ]} />);
    });
    for (let attempt = 0; attempt < 40 && !container.querySelector('.media-card'); attempt += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    }

    const cards = container.querySelectorAll('.media-card');
    expect(cards).toHaveLength(2);
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

describe('MediaCard hand-off behaviour', () => {
  const ANDROID = { isAndroid: true };
  const ELSEWHERE = { isAndroid: false };

  it('offers the provider, never itself, as the thing that will play media', () => {
    const titles = [
      renderToStaticMarkup(<MediaCard item={item()} platform={ANDROID} />),
      renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />),
      renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />),
    ];

    for (const html of titles) {
      expect(html).not.toMatch(/play (it |this )?(in|with) elara/i);
      expect(html).toMatch(/title="Open “[^”]+” on YouTube/);
    }
  });

  it('labels the action after the intent, defaulting to watch', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} platform={ELSEWHERE} />)).toContain('media-card__action">Watch');
    expect(renderToStaticMarkup(<MediaCard item={item({ intent: 'watch' })} platform={ELSEWHERE} />)).toContain('>Watch');
    expect(renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />)).toContain('>Listen');
  });

  it('keeps listen and watch on the same exact canonical provider destination', () => {
    const listen = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />);
    const watch = renderToStaticMarkup(<MediaCard item={item({ intent: 'watch' })} platform={ELSEWHERE} />);

    expect(listen).toContain('title="Open “Dark Ambient Mix — 3 Hours” on YouTube"');
    expect(listen).toContain('media-card--listen');
    expect(listen).toContain('youtube.com/watch?v=abc123');
    expect(listen).not.toContain('music.youtube.com');
    expect(watch).toContain('media-card--watch');
    expect(watch).toContain('youtube.com/watch?v=abc123');
  });

  it('still never embeds a player for a listen request', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);
    expect(html).not.toMatch(/<iframe|<video|<audio/i);
    expect(html).not.toContain('autoplay');
  });

  it('hands the same canonical URL through an unpinned Android intent', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(html).toContain('intent://www.youtube.com/watch?v=abc123#Intent;');
    expect(html).toContain('browser_fallback_url');
    expect(html).not.toContain(';package=');
    expect(html).not.toContain('music.youtube.com');
  });

  it('shows no duration, because search.list does not provide one', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} platform={ELSEWHERE} />)).not.toContain('media-card__duration');
    expect(cssSheet).not.toMatch(/\.media-card__duration/);
  });

  it('stays one control, so a tap anywhere on the card works', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
  });

  it('renders each item of a mixed rail with its own intent', async () => {
    await act(async () => {
      root.render(<MessageMedia items={[
        item({ id: 'v1', intent: 'watch', title: 'Clip', webUrl: 'https://www.youtube.com/watch?v=v1' }),
        item({ id: 'm1', intent: 'listen', title: 'Track', webUrl: 'https://www.youtube.com/watch?v=m1' }),
      ]} />);
    });
    for (let attempt = 0; attempt < 40 && container.querySelectorAll('.media-card').length < 2; attempt += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    }

    const cards = [...container.querySelectorAll('.media-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Watch');
    expect(cards[1].textContent).toContain('Listen');
  });
});

describe('MediaCard stylesheet contract', () => {
  const css = cssSheet;

  it('reserves the thumbnail box at the ratio the provider actually serves', () => {
    expect(css).toMatch(/\.media-card__thumb\s*\{[^}]*aspect-ratio:\s*16 \/ 9/s);
    expect(css).not.toMatch(/aspect-ratio:\s*4 \/ 3/);
  });

  it('keeps the action row at a thumb-sized tap target', () => {
    expect(css).toMatch(/\.media-card__cta\s*\{[^}]*min-height:\s*44px/s);
  });

  it('makes unavailable cards visibly non-interactive', () => {
    expect(css).toMatch(/\.media-card--unavailable\s*\{[^}]*cursor:\s*default/s);
  });

  it('honours reduced-motion preferences', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
