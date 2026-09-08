import { ArtifactError } from './errors';

export interface ImagePreprocessPolicy {
  maxLongEdge?: number;
  maxBytes?: number;
  outputMime?: string;
  quality?: number;
  stripMetadata?: boolean;
}

export interface ProcessedImage {
  blob: Blob;
  mimeType: string;
  derived: boolean;
}

const derivedEncodingCache = new Map<string, Blob>();

function cacheKey(source: Blob, policy: ImagePreprocessPolicy): string {
  return [source.size, source.type, policy.maxLongEdge ?? '', policy.maxBytes ?? '', policy.outputMime ?? '', policy.quality ?? '', policy.stripMetadata ?? true].join('|');
}

function canDecodeImage(): boolean {
  return typeof createImageBitmap === 'function';
}

async function canvasBlob(canvas: OffscreenCanvas | HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas did not produce an image.')), mimeType, quality);
  });
}

function nativeFormatSupported(mimeType: string): boolean {
  if (mimeType === 'image/avif' && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/avif').startsWith('data:image/avif');
  }
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp';
}

export async function preprocessImage(source: Blob, policy: ImagePreprocessPolicy = {}): Promise<ProcessedImage> {
  if (!source.type.startsWith('image/')) {
    throw new ArtifactError('IMAGE_PROCESSING_FAILED', 'Only image attachments can be preprocessed.');
  }
  const effectivePolicy: ImagePreprocessPolicy = { stripMetadata: true, ...policy };
  const needsResize = effectivePolicy.maxLongEdge !== undefined;
  const needsFormat = effectivePolicy.outputMime !== undefined && effectivePolicy.outputMime !== source.type;
  const needsMetadataStrip = effectivePolicy.stripMetadata === true;
  if (!needsResize && !needsFormat && !needsMetadataStrip && (!effectivePolicy.maxBytes || source.size <= effectivePolicy.maxBytes)) {
    return { blob: source, mimeType: source.type, derived: false };
  }

  const key = cacheKey(source, effectivePolicy);
  const cached = derivedEncodingCache.get(key);
  if (cached) return { blob: cached, mimeType: cached.type || source.type, derived: true };
  if (!canDecodeImage()) throw new ArtifactError('IMAGE_PROCESSING_FAILED', 'This browser cannot process the selected image.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new ArtifactError('IMAGE_PROCESSING_FAILED', 'The selected image could not be decoded safely.', cause);
  }

  try {
    const maxLongEdge = effectivePolicy.maxLongEdge && effectivePolicy.maxLongEdge > 0 ? effectivePolicy.maxLongEdge : Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const requestedMime = effectivePolicy.outputMime && nativeFormatSupported(effectivePolicy.outputMime) ? effectivePolicy.outputMime : source.type;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);

    let result = await canvasBlob(canvas, requestedMime, effectivePolicy.quality);
    if (effectivePolicy.maxBytes && result.size > effectivePolicy.maxBytes && requestedMime !== 'image/png') {
      for (const quality of [0.86, 0.74, 0.62, 0.5]) {
        result = await canvasBlob(canvas, requestedMime, Math.min(effectivePolicy.quality ?? 0.92, quality));
        if (result.size <= effectivePolicy.maxBytes) break;
      }
    }
    derivedEncodingCache.set(key, result);
    return { blob: result, mimeType: result.type || requestedMime, derived: true };
  } catch (cause) {
    throw new ArtifactError('IMAGE_PROCESSING_FAILED', 'The image could not be safely transformed.', cause);
  } finally {
    bitmap.close();
  }
}

export function clearImagePreprocessCache(): void {
  derivedEncodingCache.clear();
}
