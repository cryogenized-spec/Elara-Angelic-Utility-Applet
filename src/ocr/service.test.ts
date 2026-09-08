import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OCRWorkerRequest, OCRWorkerResponse } from './contracts';

vi.mock('../artifacts/image-preprocessing', () => ({
  preprocessImage: vi.fn(async (blob: Blob) => ({ blob, mimeType: blob.type, derived: false })),
}));

import { createOCRService } from './service';

class FakeWorker {
  onmessage: ((event: MessageEvent<OCRWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(message: OCRWorkerRequest): void {
    queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, result: { text: 'receipt total', blocks: [{ text: 'receipt total', confidence: 91 }], confidence: 91, language: 'eng' } } } as MessageEvent<OCRWorkerResponse>));
  }
  terminate(): void { this.terminated = true; }
}

describe('OCR service worker boundary', () => {
  let worker: FakeWorker;
  beforeEach(() => { worker = new FakeWorker(); });

  it('returns structured recognition results from a worker', async () => {
    const service = createOCRService(() => worker);
    const result = await service.recognize(new Blob(['image'], { type: 'image/png' }));
    expect(result).toEqual(expect.objectContaining({ text: 'receipt total', language: 'eng' }));
    expect(result.blocks[0]).toMatchObject({ text: 'receipt total', confidence: 91 });
    expect(worker.terminated).toBe(true);
  });

  it('times out and terminates a stuck worker', async () => {
    const stuck = new FakeWorker();
    stuck.postMessage = () => undefined;
    const service = createOCRService(() => stuck);
    await expect(service.recognize(new Blob(['image'], { type: 'image/png' }), { timeoutMs: 1_000 })).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
    expect(stuck.terminated).toBe(true);
    expect(stuck.onmessage).toBeNull();
    expect(stuck.onerror).toBeNull();
  }, 5_000);

  it('cancels exactly once, removes worker listeners, and ignores a late worker result', async () => {
    const cancelled = new FakeWorker();
    cancelled.postMessage = () => undefined;
    const controller = new AbortController();
    const service = createOCRService(() => cancelled);
    const pending = service.recognize(new Blob(['image'], { type: 'image/png' }), { signal: controller.signal });
    await vi.waitFor(() => expect(cancelled.onmessage).not.toBeNull());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled.terminated).toBe(true);
    expect(cancelled.onmessage).toBeNull();
    expect(cancelled.onerror).toBeNull();
    expect(() => cancelled.onmessage?.({ data: { id: 'late', ok: true, result: { text: 'late', blocks: [] } } } as unknown as MessageEvent<OCRWorkerResponse>)).not.toThrow();
  });
});
