import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearImagePreprocessCache, preprocessImage } from './image-preprocessing';

class FakeCanvas {
  width = 0;
  height = 0;
  getContext() { return { drawImage: vi.fn() }; }
  async convertToBlob(options: { type: string }) { return new Blob(['encoded'], { type: options.type }); }
}

describe('image preprocessing policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearImagePreprocessCache();
  });

  it('strips metadata through a derived re-encoding while preserving the source Blob', async () => {
    const source = new Blob(['original'], { type: 'image/png' });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 50, close: vi.fn() })));
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    const processed = await preprocessImage(source, { stripMetadata: true });
    expect(processed.derived).toBe(true);
    expect(processed.mimeType).toBe('image/png');
    expect(source.size).toBe(8);
    expect(processed.blob.size).toBe(7);
  });

  it('falls back from unsupported AVIF encoding to the canonical format', async () => {
    const source = new Blob(['original'], { type: 'image/png' });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.spyOn(document, 'createElement').mockReturnValue({ toDataURL: () => 'data:image/png;base64,AA==' } as unknown as HTMLCanvasElement);
    const processed = await preprocessImage(source, { outputMime: 'image/avif', stripMetadata: true });
    expect(processed.mimeType).toBe('image/png');
  });
});
