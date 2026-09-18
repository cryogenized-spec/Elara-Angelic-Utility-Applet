// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_ACTIVITY_GLYPHS } from '../domain/preferences';
import {
  commitNotoEmoji,
  getNotoEmojiReady,
  notoEmojiCssUrl,
  previewNotoEmoji,
  restoreNotoEmoji,
} from './noto-emoji';

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors?: FontFaceDescriptors,
  ) {}
  async load(): Promise<FakeFontFace> { return this; }
}

class FakeCache {
  private readonly entries = new Map<string, Response>();
  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    const response = this.entries.get(String(key));
    return response?.clone();
  }
  async put(key: RequestInfo | URL, value: Response): Promise<void> {
    this.entries.set(String(key), value.clone());
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(key: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(typeof key === 'string' ? key : key.toString());
  }
}

let cache: FakeCache;
let fetchMock: ReturnType<typeof vi.fn>;
const addedFaces: FakeFontFace[] = [];

function stylesheet(): string {
  return "@font-face { font-family: 'Noto Emoji'; font-style: normal; font-weight: 300; src: url(https://fonts.gstatic.com/s/notoemoji/test.woff2) format('woff2'); }";
}

beforeEach(() => {
  cache = new FakeCache();
  addedFaces.length = 0;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://fonts.googleapis.com/css2')) return new Response(stylesheet(), { status: 200 });
    if (url === 'https://fonts.gstatic.com/s/notoemoji/test.woff2') return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('FontFace', FakeFontFace);
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (face: FakeFontFace) => { addedFaces.push(face); },
      delete: () => true,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Noto Emoji activity font authority', () => {
  it('pins Noto Emoji weight 300 and a text-limited Google Fonts request', () => {
    const url = new URL(notoEmojiCssUrl('❤✉'));
    expect(url.origin).toBe('https://fonts.googleapis.com');
    expect(url.pathname).toBe('/css2');
    expect(url.searchParams.get('family')).toBe('Noto Emoji:wght@300');
    expect(url.searchParams.get('text')).toBe('❤✉');
  });

  it('previews through no-store network fetches without touching CacheStorage', async () => {
    const cacheOpen = (globalThis.caches.open as ReturnType<typeof vi.fn>);
    await expect(previewNotoEmoji(DEFAULT_GENERATION_ACTIVITY_GLYPHS)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(addedFaces.at(-1)?.family).toBe('Elara Noto Emoji Preview');
  });

  it('commits one final subset to cache and reuses it without another network fetch', async () => {
    await expect(commitNotoEmoji(DEFAULT_GENERATION_ACTIVITY_GLYPHS)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getNotoEmojiReady()).toBe(true);

    fetchMock.mockClear();
    await expect(commitNotoEmoji(DEFAULT_GENERATION_ACTIVITY_GLYPHS)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await cache.keys())).toHaveLength(1);
    expect(addedFaces.at(-1)?.family).toBe('Elara Noto Emoji');
  });

  it('uses a transient session font on startup cache miss without creating durable cache', async () => {
    const cachePut = vi.spyOn(cache, 'put');
    await expect(restoreNotoEmoji(DEFAULT_GENERATION_ACTIVITY_GLYPHS)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('rejects unreviewed font origins before binary retrieval', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(
      "@font-face { font-family: 'Noto Emoji'; font-weight: 300; src: url(https://example.com/font.woff2) format('woff2'); }",
      { status: 200 },
    ));
    await expect(previewNotoEmoji(DEFAULT_GENERATION_ACTIVITY_GLYPHS)).rejects.toThrow(/reviewed font asset|exactly one reviewed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
