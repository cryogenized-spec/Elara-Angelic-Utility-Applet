import { describe, expect, it } from 'vitest';
import { ArtifactError } from './errors';
import { validateFile } from './validation';

describe('artifact file validation', () => {
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
});
