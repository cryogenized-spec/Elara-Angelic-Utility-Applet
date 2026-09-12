import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../domain/media';
import {
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

/** Decodes the `S.browser_fallback_url=` value out of an intent URI. */
function fallbackOf(href: string): string {
  const match = /S\.browser_fallback_url=([^;]*)/.exec(href);
  if (!match) throw new Error(`no fallback URL in ${href}`);
  return decodeURIComponent(match[1]);
}

describe('media hand-off', () => {
  describe('on platforms without Android intent support', () => {
    it('uses the item URL verbatim', () => {
      expect(mediaHandoffHref(item(), ELSEWHERE)).toBe('https://www.youtube.com/watch?v=abc123');
    });

    it('never emits an intent:// URI, which nothing else can resolve', () => {
      expect(mediaHandoffHref(item({ intent: 'listen' }), ELSEWHERE)).not.toContain('intent://');
      expect(mediaHandoffIntentHref(item({ intent: 'listen' }), ELSEWHERE)).toBeUndefined();
    });
  });

  describe('on Android', () => {
    it('href is always https — never an intent:// URI that can show ERR_UNKNOWN_URL_SCHEME', () => {
      const href = mediaHandoffHref(item(), ANDROID);
      expect(href).toBe('https://www.youtube.com/watch?v=abc123');
      expect(href).not.toContain('intent://');
    });

    it('intent href wraps the destination in an intent URI with the required terminator', () => {
      const href = mediaHandoffIntentHref(item(), ANDROID);
      expect(href).toBeDefined();
      expect(href!.startsWith('intent://www.youtube.com/watch?v=abc123#Intent;')).toBe(true);
      // Android requires the literal `;end` terminator or the whole URI is inert.
      expect(href!.endsWith(';end')).toBe(true);
      expect(href).toContain('scheme=https;');
      expect(href).toContain('action=android.intent.action.VIEW');
      expect(href).toContain('category=android.intent.category.BROWSABLE');
    });

    it('does not pin a package, because pinning would suppress the app picker', () => {
      // The whole point of the Android path is that the user chooses their own
      // player. A `package=` component would send every tap to one app.
      const href = mediaHandoffIntentHref(item({ intent: 'listen' }), ANDROID);

      // Asserted alongside the positive case: without this the test would also
      // pass if Android support were deleted and every href became a plain URL.
      expect(href).toContain('intent://');
      expect(href).not.toMatch(/;package=/);
    });

    it('carries a browser fallback so an unresolved intent still navigates', () => {
      const href = mediaHandoffIntentHref(item(), ANDROID);

      expect(href).toBeDefined();
      expect(fallbackOf(href!)).toBe('https://www.youtube.com/watch?v=abc123');
    });
  });

  describe('the listen intent', () => {
    it('prefers the music surface for a single video', () => {
      expect(mediaDestinationUrl(item({ intent: 'listen' })))
        .toBe('https://music.youtube.com/watch?v=abc123');
    });

    it('keeps a start offset so "play it from 0:42" survives hand-off', () => {
      expect(mediaDestinationUrl(item({
        intent: 'listen',
        webUrl: 'https://www.youtube.com/watch?v=abc123&t=42s',
      }))).toBe('https://music.youtube.com/watch?v=abc123&t=42s');
    });

    it('leaves a playlist alone rather than rewriting a URL it does not own', () => {
      const playlist = item({
        kind: 'playlist',
        id: 'PL9',
        webUrl: 'https://www.youtube.com/playlist?list=PL9sKd',
        intent: 'listen',
      });

      expect(mediaDestinationUrl(playlist)).toBe('https://www.youtube.com/playlist?list=PL9sKd');
    });

    it('trusts the declared kind over the URL shape when the two disagree', () => {
      // Provider data is external input. An item flagged as a playlist stays a
      // playlist even when its link looks like a single watch URL: rewriting it
      // into a music track would silently drop every other entry.
      const contradictory = item({
        kind: 'playlist',
        id: 'PL9',
        webUrl: 'https://www.youtube.com/watch?v=abc123&list=PL9sKd',
        intent: 'listen',
      });

      expect(mediaDestinationUrl(contradictory))
        .toBe('https://www.youtube.com/watch?v=abc123&list=PL9sKd');
    });

    it('leaves a video URL without a usable id untouched', () => {
      const malformed = item({ webUrl: 'https://www.youtube.com/watch', intent: 'listen' });

      expect(mediaDestinationUrl(malformed)).toBe('https://www.youtube.com/watch');
    });

    it('leaves a non-YouTube host alone', () => {
      const other = item({ webUrl: 'https://example.com/song', intent: 'listen' });

      expect(mediaDestinationUrl(other)).toBe('https://example.com/song');
    });

    it('routes the music URL through the Android intent and its fallback', () => {
      const href = mediaHandoffIntentHref(item({ intent: 'listen' }), ANDROID);

      expect(href).toBeDefined();
      expect(href).toContain('intent://music.youtube.com/watch?v=abc123#Intent;');
      expect(fallbackOf(href!)).toBe('https://music.youtube.com/watch?v=abc123');
    });

    it('treats a watch request as the plain web URL', () => {
      expect(mediaDestinationUrl(item({ intent: 'watch' })))
        .toBe('https://www.youtube.com/watch?v=abc123');
      expect(mediaDestinationUrl(item())).toBe('https://www.youtube.com/watch?v=abc123');
    });
  });

  it('falls back to the web URL for a link it cannot parse, instead of emitting a malformed intent', () => {
    const junk = item({ webUrl: 'not a url' });

    expect(mediaHandoffHref(junk, ANDROID)).toBe('not a url');
    expect(mediaHandoffHref(junk, ELSEWHERE)).toBe('not a url');
    expect(mediaHandoffIntentHref(junk, ANDROID)).toBeUndefined();
    expect(mediaHandoffIntentHref(junk, ELSEWHERE)).toBeUndefined();
    // Load-bearing only with the positive case: these would pass unchanged if the
    // intent builder were removed.
    expect(mediaHandoffIntentHref(item(), ANDROID)).toContain('intent://');
  });

  it('refuses to build an intent around a non-https link', () => {
    const insecure = item({ webUrl: 'http://www.youtube.com/watch?v=abc123' });

    // A hand-off URI is a launch request; it is not built from a link the
    // provider did not serve over https.
    expect(mediaHandoffHref(insecure, ANDROID)).toBe('http://www.youtube.com/watch?v=abc123');
    expect(mediaHandoffIntentHref(insecure, ANDROID)).toBeUndefined();
    expect(mediaHandoffIntentHref(item(), ANDROID)).toContain('scheme=https;');
  });

  it('names the action after the intent', () => {
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

    it('prefers the client-hints platform brand over the UA string', () => {
      // Chrome on Android reports the brand; a UA sniff alone would be the only
      // signal on browsers that lack it, and the hints must win where both exist.
      // With brands indicating Chromium, Android platform should be treated as Android.
      const restore = withNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        userAgentData: { platform: 'Android', brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
      });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: true });
      } finally {
        restore();
      }
    });

    it('does not be talked into an Android hand-off by a UA that mentions Android', () => {
      // A browser reporting a non-Android brand is authoritative: sending a
      // `intent://` URI to it would produce a dead link, not a picker.
      const restore = withNavigator({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) like Chrome',
        userAgentData: { platform: 'Windows' },
      });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: false });
      } finally {
        restore();
      }
    });

    it('requires Chrome on Android for intent support, not just any Android UA', () => {
      // Firefox on Android does not support intent:// — it would show ERR_UNKNOWN_URL_SCHEME.
      const restoreFirefox = withNavigator({ userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0' });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: false });
      } finally {
        restoreFirefox();
      }

      // Chrome on Android does support intent.
      const restoreChrome = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: true });
      } finally {
        restoreChrome();
      }

      // Samsung Internet on Android also supports intent.
      const restoreSamsung = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/122.0.0.0 Mobile Safari/537.36' });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: true });
      } finally {
        restoreSamsung();
      }
    });

    it('falls back to the UA when the brand is missing or blank', () => {
      const restoreBlank = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', userAgentData: { platform: '   ' } });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: true });
      } finally {
        restoreBlank();
      }

      const restoreMissing = withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: true });
      } finally {
        restoreMissing();
      }

      const restoreDesktop = withNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: false });
      } finally {
        restoreDesktop();
      }
    });

    it('treats a missing navigator as non-Android rather than throwing', () => {
      const restore = withNavigator(undefined);
      try {
        expect(detectHandoffPlatform()).toEqual({ isAndroid: false });
      } finally {
        restore();
      }
    });
  });
});
