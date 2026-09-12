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

/**
 * The stylesheet as text. Some layout invariants below are not observable through
 * React's output and were broken at least once in this sheet's history, so they
 * are asserted against the source rather than left to visual review.
 *
 * Resolved from the project root: this suite runs in jsdom, where
 * `import.meta.url` is a served URL rather than a path on disk.
 */
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

    // Wording is for a screen-reader user, not a developer: the label names what
    // the group contains rather than describing how it was produced.
    expect(container.querySelector('.media-rail')?.getAttribute('aria-label')).toBe('Media results from YouTube');
  });
});

describe('MediaCard hand-off behaviour', () => {
  const ANDROID = { isAndroid: true };
  const ELSEWHERE = { isAndroid: false };

  it('offers the platform, never itself, as the thing that will play media', () => {
    const titles = [
      renderToStaticMarkup(<MediaCard item={item()} platform={ANDROID} />),
      renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />),
      renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />),
    ];

    // Wording matters here: "Play in Elara" would be a false promise, and so is
    // a card that implies nothing happens when a tap leaves the browser.
    for (const html of titles) {
      expect(html).not.toMatch(/play (it |this )?(in|with) elara/i);
      expect(html).toMatch(/title="Open “[^”]+” (in|on) /);
    }
  });

  it('labels the action after the intent, defaulting to watch', () => {
    expect(renderToStaticMarkup(<MediaCard item={item()} platform={ELSEWHERE} />))
      .toContain('media-card__action">Watch');
    expect(renderToStaticMarkup(<MediaCard item={item({ intent: 'watch' })} platform={ELSEWHERE} />))
      .toContain('>Watch');
    expect(renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />))
      .toContain('>Listen');
  });

  it('names the same destination in its tooltip that its href will actually open', () => {
    // The wording and the link are computed from the intent separately, so this is
    // the pair most likely to drift: a card that says "on YouTube" but launches a
    // music app is a broken promise in five words.
    const musicElsewhere = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />);
    expect(musicElsewhere).toContain('in YouTube Music"');
    expect(musicElsewhere).toContain('media-card--listen');
    expect(musicElsewhere).toContain('music.youtube.com');

    const musicAndroid = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);
    expect(musicAndroid).toContain('in your music app"');

    const watchHtml = renderToStaticMarkup(<MediaCard item={item()} platform={ELSEWHERE} />);
    expect(watchHtml).toContain('on YouTube"');
    expect(watchHtml).toContain('media-card--watch');
    expect(watchHtml).not.toContain('music.youtube.com');
  });

  it('still never embeds a player for a listen request', () => {
    // The original invariant has to survive the new feature: an audio intent is
    // a reason to hand off more eagerly, not a licence to add an <audio> tag.
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);

    expect(html).not.toMatch(/<iframe|<video|<audio/i);
    expect(html).not.toContain('autoplay');
  });

  it('hands off through an intent URI on Android', () => {
    const html = renderToStaticMarkup(<MediaCard item={item()} platform={ANDROID} />);

    expect(html).toContain('intent://www.youtube.com/watch?v=abc123#Intent;');
    expect(html).toContain('browser_fallback_url');
  });

  it('sends a listen request to the music surface, and a playlist to the watch page', () => {
    const music = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ELSEWHERE} />);
    expect(music).toContain('music.youtube.com/watch?v=abc123');

    const playlist = renderToStaticMarkup(<MediaCard
      item={item({ kind: 'playlist', intent: 'listen', webUrl: 'https://www.youtube.com/playlist?list=PL9' })}
      platform={ELSEWHERE}
    />);
    expect(playlist).toContain('youtube.com/playlist?list=PL9');
    expect(playlist).not.toContain('music.youtube.com');
  });

  it('shows no duration, because inventing one would cost a second billed call', () => {
    // The provider never sets `durationSeconds`: `search.list` does not return a
    // duration, and looking one up means another call per result. Pinning the
    // absence here is what stops a future edit from adding a fake `0:00` badge.
    expect(renderToStaticMarkup(<MediaCard item={item()} platform={ELSEWHERE} />))
      .not.toContain('media-card__duration');
    expect(cssSheet).not.toMatch(/\.media-card__duration/);
  });

  it('stays one control, so a tap anywhere on the card works', () => {
    const html = renderToStaticMarkup(<MediaCard item={item({ intent: 'listen' })} platform={ANDROID} />);

    // A nested <a> or <button> would be invalid markup and create a dead zone in
    // the middle of the tap target.
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
  });

  it('renders each item of a mixed rail with its own intent', async () => {
    await act(async () => {
      root.render(<MessageMedia items={[
        item({ id: 'v1', intent: 'watch', title: 'Clip' }),
        item({ id: 'm1', intent: 'listen', title: 'Track' }),
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
  // The layout invariants below are not observable through React's output, and
  // each one was already broken at least once in this sheet's history, so they
  // are asserted against the source instead of left to visual review.
  // Resolved from the project root: this suite runs in jsdom, where
  // `import.meta.url` is a served URL rather than a path on disk.
  const css = cssSheet;

  it('reserves the thumbnail box at the ratio the provider actually serves', () => {
    expect(css).toMatch(/\.media-card__thumb\s*\{[^}]*aspect-ratio:\s*16 \/ 9/s);
    expect(css).not.toMatch(/aspect-ratio:\s*4 \/ 3/);
  });

  it('keeps the action row at a thumb-sized tap target', () => {
    expect(css).toMatch(/\.media-card__cta\s*\{[^}]*min-height:\s*44px/s);
  });

  it('honours reduced-motion preferences', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
