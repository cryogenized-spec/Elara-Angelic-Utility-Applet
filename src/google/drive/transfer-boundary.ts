import { DriveTransferError } from './errors';
import { DRIVE_LIMITS } from './limits';

export interface BoundedGoogleContent {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

function transferTooLarge(operation: string): DriveTransferError {
  return new DriveTransferError('DRIVE_FILE_TOO_LARGE', `${operation} exceeds the application transfer limit.`);
}

export function boundedGoogleTransferLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) return DRIVE_LIMITS.maxTransferBytes;
  return Math.max(1, Math.min(DRIVE_LIMITS.maxTransferBytes, Math.trunc(maxBytes)));
}

export async function readBoundedGoogleContent(
  response: Response,
  operation: string,
  limit: number,
  signal?: AbortSignal,
): Promise<BoundedGoogleContent> {
  if (!response.ok) throw new DriveTransferError('DRIVE_TRANSFER_FAILED', `${operation} failed (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > limit) throw transferTooLarge(operation);
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream';

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
    if (bytes.byteLength > limit) throw transferTooLarge(operation);
    return { mimeType, bytes };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
      total += value.byteLength;
      if (total > limit) throw transferTooLarge(operation);
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    if (cause instanceof DriveTransferError || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
    throw new DriveTransferError('DRIVE_TRANSFER_FAILED', `${operation} failed while reading the response.`, cause);
  }

  if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mimeType, bytes };
}
