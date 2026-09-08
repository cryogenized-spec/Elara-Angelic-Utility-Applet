import type { OCRRecognizeOptions, OCRRegion, OCRResult, OCRService, OCRWorkerRequest, OCRWorkerResponse } from './contracts';
import { ArtifactError } from '../artifacts/errors';
import { ARTIFACT_LIMITS } from '../artifacts/limits';
import { preprocessImage } from '../artifacts/image-preprocessing';

interface WorkerLike {
  postMessage(message: OCRWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<OCRWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

function workerFactory(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function requestId(): string {
  return crypto.randomUUID();
}

function timeoutFor(options?: OCRRecognizeOptions): number {
  return Math.max(1_000, Math.min(options?.timeoutMs ?? ARTIFACT_LIMITS.maxOcrDurationMs, ARTIFACT_LIMITS.maxOcrDurationMs));
}

export function createOCRService(createWorker: () => WorkerLike = workerFactory): OCRService {
  async function recognize(image: Blob, options: OCRRecognizeOptions = {}): Promise<OCRResult> {
    if (!image || !image.type.startsWith('image/')) throw new ArtifactError('OCR_FAILED', 'OCR needs an image attachment.');
    if (image.size > ARTIFACT_LIMITS.maxAttachmentBytes) throw new ArtifactError('FILE_TOO_LARGE', 'This OCR input is too large.');
    const normalized = await preprocessImage(image, { maxLongEdge: ARTIFACT_LIMITS.maxOcrLongEdge, stripMetadata: true });
    const worker = createWorker();
    const id = requestId();
    const timeoutMs = timeoutFor(options);
    return new Promise<OCRResult>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        callback();
      };
      const timer = window.setTimeout(() => finish(() => reject(new ArtifactError('OCR_TIMEOUT', 'OCR took too long and was stopped.'))), timeoutMs);
      const abort = () => finish(() => reject(new DOMException('OCR was cancelled.', 'AbortError')));
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        window.clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (!event.data.ok || !event.data.result) {
          finish(() => reject(new ArtifactError('OCR_FAILED', event.data.error ?? 'OCR failed.')));
          return;
        }
        finish(() => resolve(event.data.result!));
      };
      worker.onerror = () => {
        window.clearTimeout(timer);
        finish(() => reject(new ArtifactError('OCR_FAILED', 'OCR could not process this image.')));
      };
      const request: OCRWorkerRequest = { id, blob: normalized.blob, language: options.language ?? 'eng', region: options.region };
      worker.postMessage(request);
    });
  }

  return {
    recognize,
    recognizeRegion(image: Blob, crop: OCRRegion, options: Omit<OCRRecognizeOptions, 'region'> = {}) {
      return recognize(image, { ...options, region: crop });
    },
  };
}

export const ocrService = createOCRService();
