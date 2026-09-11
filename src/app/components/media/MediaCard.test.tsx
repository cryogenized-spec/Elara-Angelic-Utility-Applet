// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaCard } from './MediaCard';
import { MessageMedia } from './MessageMedia';
import type { MediaItem } from '../../../domain/media';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

    // No iframe means no player script, no autoplay, and nothing heavy to load.
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
    const html = renderToStaticMarkup(<MediaCard item={item()} />);

    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('defers the thumbnail and hides it from assistive tech', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} />);

    // The title is the accessible name; the image is decorative.
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
    expect(renderToStaticMarkup(<MediaCard item={item({ channel: undefined })} />))
      .not.toContain('media-card__channel');
  });

  it('states its provenance so a resolved video is never mistaken for a local artifact', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} />)).toContain('YouTube');
  });

  it('uses the item URL verbatim rather than rebuilding it', () => {
    const custom = item({ webUrl: 'https://www.youtube.com/watch?v=abc123&t=42s' });
    expect(renderToStaticMarkup(<MediaCard item={custom} />)).toContain('https://www.youtube.com/watch?v=abc123&amp;t=42s');
  });
});

describe('MessageMedia', () => {
  it('renders nothing at all when a message carries no media', () => {
    expect(renderToStaticMarkup(<MessageMedia items={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<MessageMedia items={[]} />)).toBe('');
  });

  it('loads the card lazily and renders every item', async () => {
    await act(async () => { root.render(<MessageMedia items={[item(), item({ id: 'def456', title: 'Second', webUrl: 'https://www.youtube.com/watch?v=def456' })]} />); });
    // Let the dynamic import behind React.lazy settle.
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

    expect(container.querySelector('.media-rail')?.getAttribute('aria-label')).toBe('Resolved YouTube results');
  });
});
