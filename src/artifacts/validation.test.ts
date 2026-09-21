import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactError } from './errors';
import { validateFile } from './validation';

describe('artifact file validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('accepts a valid PDF signature', async () => {
    const file = new File(['%PDF-1.7\ncontent'], 'receipt.pdf', { type: 'application/pdf' });
    await expect(validateFile(file)).resolves.toMatchObject({ name: 'receipt.pdf', mimeType: 'application/pdf', kind: 'document' });
  });

  it('rejects a mismatched image signature', async () => {
    const file = new File(['not a png'], 'photo.png', { type: 'image/png' });
    await expect(validateFile(file)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });

  it('rejects unsupported and empty files with structured errors', async () => {
    await expect(validateFile(new File([], 'empty.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await expect(validateFile(new File(['binary'], 'program.exe', { type: 'application/x-msdownload' }))).rejects.toBeInstanceOf(ArtifactError);
  });

  it('rejects a signature-valid raster whose decoded dimensions exceed the pixel safety budget', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 6000, height: 5000, close })));
    const file = new File([pngHeader], 'huge.png', { type: 'image/png' });

    await expect(validateFile(file)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(close).toHaveBeenCalledOnce();
  });

});
