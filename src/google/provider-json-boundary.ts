export interface ProviderJsonBoundaryOptions {
  readonly operation: string;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

function tooLarge(operation: string): Error {
  return new Error(`${operation} response exceeds the application byte limit.`);
}

function assertCurrent(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
}

/**
 * Read provider JSON under a hard byte ceiling before parsing.
 *
 * Content-Length is advisory only: chunked or dishonest responses are counted
 * while streaming and cancelled as soon as they cross the ceiling. This keeps
 * hostile/provider-bug payloads from becoming an unbounded JSON.parse/model
 * amplification surface.
 */
export async function readBoundedProviderJson<T>(
  response: Response,
  options: ProviderJsonBoundaryOptions,
): Promise<T> {
  const { operation, maxBytes, signal } = options;
  if (!response.ok) throw new Error(`${operation} failed (${response.status}).`);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('Provider JSON byte limit is invalid.');
  assertCurrent(signal, operation);

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(operation);

  let bytes: Uint8Array;
  if (!response.body) {
    const raw = new Uint8Array(await response.arrayBuffer());
    assertCurrent(signal, operation);
    if (raw.byteLength > maxBytes) throw tooLarge(operation);
    bytes = raw;
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        assertCurrent(signal, operation);
        total += value.byteLength;
        if (total > maxBytes) throw tooLarge(operation);
        chunks.push(value);
      }
    } catch (cause) {
      await reader.cancel().catch(() => undefined);
      throw cause;
    }
    assertCurrent(signal, operation);
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes)) as T;
  } catch (cause) {
    throw new Error(`${operation} returned invalid JSON.`, { cause });
  }
}
