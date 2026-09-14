// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../../../domain/media';
import { PlaybackProvider, type PlaybackPreferenceStore } from '../../../media/playback/PlaybackProvider';
import { ConversationSurface } from '../ConversationSurface';
import { MediaCard } from './MediaCard';
import { MessageMedia } from './MessageMedia';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preferenceStore: PlaybackPreferenceStore = {
  load: async () => 'external',
  save: async (value) => value,
};

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

    expect(html.match(/class="media-card__skeleton"/g)).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
  });

  it('replaces a thumbnail that fails after render with the normal empty-thumbnail presentation', async () => {
    await act(async () => {
      root.render(
        <PlaybackProvider preferenceStore={preferenceStore}>
          <MediaCard item={video('broken')} platform={{ isAndroid: false }} />
        </PlaybackProvider>,
      );
      await Promise.resolve();
    });
    const image = container.querySelector('img.media-card__thumb');
    expect(image).not.toBeNull();

    await act(async () => { image!.dispatchEvent(new Event('error')); });

    expect(container.querySelector('img.media-card__thumb')).toBeNull();
    expect(container.querySelector('.media-card__thumb--empty')).not.toBeNull();
  });

  it('mounts the same observable conversation stream before the first message exists', () => {
    const html = renderToStaticMarkup(<ConversationSurface messages={[]} generation={null} onRegenerate={() => undefined} />);

    expect(html).toContain('class="conversation__stream"');
    expect(html).toContain('class="empty-state"');
  });

  it('observes late growth while only explicit user gestures may elect manual scroll authority', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/ConversationSurface.tsx'), 'utf8');

    expect(source).toMatch(/const\s+stream\s*=\s*[^;]+\.current/);
    expect(source).toMatch(/resizeObserver\?\.observe\(stream\)/);
    expect(source).toMatch(/mutationObserver\?\.observe\(stream,/);
    expect(source).toMatch(/if\s*\(followModeRef\.current\s*!==\s*['"]bottom['"]\)\s*return/);
    expect(source).toContain('userScrollIntentRef');
    expect(source).toContain('if (!consumeUserScrollIntent()) return;');
    expect(source).toContain('onWheel={markUserScrollIntent}');
    expect(source).toContain('onTouchMove={markUserScrollIntent}');
  });
});
