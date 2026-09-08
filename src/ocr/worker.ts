import type { OCRBlock, OCRWorkerRequest, OCRWorkerResponse } from './contracts';

function asBlocks(value: unknown): OCRBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const entry = block as { text?: unknown; confidence?: unknown; bbox?: { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown } };
    if (typeof entry.text !== 'string') return [];
    const bounds = entry.bbox && [entry.bbox.x0, entry.bbox.y0, entry.bbox.x1, entry.bbox.y1].every((number) => typeof number === 'number')
      ? { x: entry.bbox.x0 as number, y: entry.bbox.y0 as number, width: (entry.bbox.x1 as number) - (entry.bbox.x0 as number), height: (entry.bbox.y1 as number) - (entry.bbox.y0 as number) }
      : undefined;
    return [{ text: entry.text, confidence: typeof entry.confidence === 'number' ? entry.confidence : undefined, bounds }];
  });
}

self.onmessage = async (event: MessageEvent<OCRWorkerRequest>) => {
  const request = event.data;
  const respond = (response: OCRWorkerResponse) => self.postMessage(response);
  try {
    const tesseractModule = await import('tesseract.js');
    const tesseract = tesseractModule.default ?? tesseractModule;
    const assetBasePath = import.meta.env.VITE_OCR_ASSET_BASE_PATH as string | undefined;
    const worker = await tesseract.createWorker(request.language || 'eng', undefined, assetBasePath ? {
      workerPath: `${assetBasePath}/worker.min.js`,
      corePath: `${assetBasePath}/tesseract-core.wasm.js`,
      langPath: `${assetBasePath}/lang-data`,
    } : undefined);
    try {
      const recognized = await worker.recognize(request.blob, request.region ? { rectangle: { left: request.region.x, top: request.region.y, width: request.region.width, height: request.region.height } } : undefined, { blocks: true, text: true });
      const data = recognized.data as { text?: unknown; confidence?: unknown; blocks?: unknown };
      respond({
        id: request.id,
        ok: true,
        result: {
          text: typeof data.text === 'string' ? data.text.trim() : '',
          blocks: asBlocks(data.blocks),
          confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
          language: request.language || 'eng',
        },
      });
    } finally {
      await worker.terminate();
    }
  } catch (cause) {
    respond({ id: request.id, ok: false, error: cause instanceof Error ? cause.message : 'OCR failed.' });
  }
};
