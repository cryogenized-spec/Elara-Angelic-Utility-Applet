import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../domain/media';
import {
  canonicalMediaWebUrl,
  detectHandoffPlatform,
  mediaDestinationUrl,
  mediaHandoffHref,
  mediaHandoffIntentHref,
  mediaHandoffLabel,
} from './handoff';

const ANDROID = { isAndroid: true } as const;
const ELSEWHERE = { isAndroid: false } as const;

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    provider: 'youtube',
    id: 'abc123',
    kind: 'video',
    title: 'Lo-Fi Study Session',
    webUrl: 'https://www.youtube.com/watch?v=abc123',
    embedUrl: 'https://www.youtube-nocookie.com/embed/abc123?autoplay=0',
    ...overrides,
  };
}

function fallbackOf(href: string): string {
  const match = /S\.browser_fallback_url=([^;]*)/.exec(href);
  if (!match) throw new Error(`no fallback URL in ${href}`);
  return decodeURIComponent(match[1]);
}

describe('media hand-off', () => {
  describe('canonical destination', () => {
    it('derives the only accepted YouTube destination from provider, kind and id', () => {
      expect(canonicalMediaWebUrl(item())).toBe('https://www.youtube.com/watch?v=abc123');
      expect(canonicalMediaWebUrl(item({ kind: 'playlist', id: 'PL123' })))
        .toBe('https://www.youtube.com/playlist?list=PL123');
    });

    it('keeps watch and listen on the same canonical YouTube result', () => {
      expect(mediaDestinationUrl(item({ intent: 'watch' }))).toBe('https://www.youtube.com/watch?v=abc123');
      expect(mediaDestinationUrl(item({ intent: 'listen' }))).toBe('https://www.youtube.com/watch?v=abc123');
      expect(mediaDestinationUrl(item({ intent: 'listen' }))).not.toContain('music.youtube.com');
    });

    it.each([
      ['javascript:alert(1)', 'javascript scheme'],
      ['data:text/html,hello', 'data scheme'],
      ['http://www.youtube.com/watch?v=abc123', 'plain HTTP'],
      ['https://evil.example/watch?v=abc123', 'hostile HTTPS host'],
      ['https://youtube.com/watch?v=abc123', 'non-canonical host alias'],
      ['https://www.youtube.com/watch?v=other', 'mismatched video id'],
      ['https://www.youtube.com/watch?v=abc123&t=42s', 'unexpected extra parameters'],
      ['not a url', 'malformed URL'],
    ])('fails closed for %s (%s)', (webUrl) => {
      const unsafe = item({ webUrl });
      expect(mediaDestinationUrl(unsafe)).toBeUndefined();
      expect(mediaHandoffHref(unsafe, ELSEWHERE)).toBeUndefined();
      expect(mediaHandoffHref(unsafe, ANDROID)).toBeUndefined();
      expect(mediaHandoffIntentHref(unsafe, ANDROID)).toBeUndefined();
    });

    it('rejects a URL whose shape contradicts the declared kind', () => {
      const contradictory = item({
        kind: 'playlist',
        id: 'PL123',
        webUrl: 'https://www.youtube.com/watch?v=PL123',
      });
      expect(mediaDestinationUrl(contradictory)).toBeUndefined();
    });
  });

  describe('on platforms without Android intent support', () => {
    it('uses the canonical YouTube URL', () => {
      expect(mediaHandoffHref(item(), ELSEWHERE)).toBe('https://www.youtube.com/watch?v=abc123');
    });

    it('never emits an intent:// URI', () => {
      expect(mediaHandoffHref(item({ intent: 'listen' }), ELSEWHERE)).not.toContain('intent://');
      expect(mediaHandoffIntentHref(item({ intent: 'listen' }), ELSEWHERE)).toBeUndefined();
    });
  });

  describe('on Android', () => {
    it('keeps the ordinary href https and wraps the exact destination in the optional intent', () => {
      const media = item({ intent: 'listen' });
      const href = mediaHandoffHref(media, ANDROID);
      const intent = mediaHandoffIntentHref(media, ANDROID);

      expect(href).toBe('https://www.youtube.com/watch?v=abc123');
      expect(intent).toBeDefined();
      expect(intent).toContain('intent://www.youtube.com/watch?v=abc123#Intent;');
      expect(intent).toContain('scheme=https;');
      expect(intent).toContain('action=android.intent.action.VIEW');
      expect(intent).toContain('category=android.intent.category.BROWSABLE');
      expect(intent).not.toMatch(/;package=/);
      expect(intent?.endsWith(';end')).toBe(true);
      expect(fallbackOf(intent ?? '')).toBe('https://www.youtube.com/watch?v=abc123');
    });
  });

  it('names the action after the intent without changing the destination', () => {
    expect(mediaHandoffLabel(item({ intent: 'listen' }))).toBe('Listen');
    expect(mediaHandoffLabel(item({ intent: 'watch' }))).toBe('Watch');
    expect(mediaHandoffLabel(item())).toBe('Watch');
  });

  describe('platform detection', () => {
    type NavigatorLike = { userAgent?: string; userAgentData?: { platform?: string; brands?: Array<{ brand: string }> } };
    const globalRef = globalThis as unknown as { navigator?: NavigatorLike };
    const original = globalRef.navigator;

    function withNavigator(value: NavigatorLike | undefined): () => void {
      if (value === undefined) delete globalRef.navigator;
      else Object.defineProperty(globalRef, 'navigator', { value, configurable: true, writable: true });
      return () => {
        if (original === undefined) delete globalRef.navigator;
        else Object.defineProperty(globalRef, 'navigator', { value: original, configurable: true, writable: true });
      };
    }

    it('prefers client hints when they identify Android Chromium', () => {
      const restore = withNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        userAgentData: { platform: 'Android', brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
      });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: true }); } finally { restore(); }
    });

    it('does not infer Android when authoritative hints say another platform', () => {
      const restore = withNavigator({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) like Chrome',
        userAgentData: { platform: 'Windows' },
      });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: false }); } finally { restore(); }
    });

    it('requires a Chromium-family Android browser for intent support', () => {
      const restoreFirefox = withNavigator({ userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0' });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: false }); } finally { restoreFirefox(); }

      const restoreChrome = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: true }); } finally { restoreChrome(); }

      const restoreSamsung = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/122.0.0.0 Mobile Safari/537.36' });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: true }); } finally { restoreSamsung(); }
    });

    it('falls back to UA detection when hints are unavailable', () => {
      const restore = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: true }); } finally { restore(); }
    });

    it('treats a missing navigator as non-Android', () => {
      const restore = withNavigator(undefined);
      try { expect(detectHandoffPlatform()).toEqual({ isAndroid: false }); } finally { restore(); }
    });
  });
});
