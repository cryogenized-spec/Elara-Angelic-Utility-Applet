// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../../../domain/media';
import { MediaCard } from './MediaCard';
import { MessageMedia } from './MessageMedia';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function video(id: string): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title: `Video ${id}`,
    channel: 'Channel',
    thumbnail: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 },
    webUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
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

describe('Phase 3 media delivery resilience', () => {
  it('reserves one visible card shell per result while the lazy card module is unresolved', () => {
    const html = renderToStaticMarkup(<MessageMedia items={[video('one'), video('two')]} />);

    expect(html.match(/media-card__skeleton/g)).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
  });

  it('replaces a thumbnail that fails after render with the normal empty-thumbnail presentation', async () => {
    await act(async () => { root.render(<MediaCard item={video('broken')} platform={{ isAndroid: false }} />); });
    const image = container.querySelector('img.media-card__thumb');
    expect(image).not.toBeNull();

    await act(async () => { image!.dispatchEvent(new Event('error')); });

    expect(container.querySelector('img.media-card__thumb')).toBeNull();
    expect(container.querySelector('.media-card__thumb--empty')).not.toBeNull();
  });

  it('observes conversation-stream growth as well as viewport resizing without weakening manual-scroll authority', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/ConversationSurface.tsx'), 'utf8');

    expect(source).toMatch(/const\s+stream\s*=\s*[^;]+\.current/);
    expect(source).toMatch(/observer\.observe\(stream\)/);
    expect(source).toMatch(/if\s*\(followModeRef\.current\s*!==\s*['"]bottom['"]\)\s*return/);
  });
});
