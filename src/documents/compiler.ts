import { ArtifactError } from '../artifacts/errors';
import { ARTIFACT_LIMITS } from '../artifacts/limits';

export interface CompilePdfResult {
  pdf: Blob;
  compilationLog: string;
}

interface CompilerWorkerRequest {
  id: string;
  source: string;
  basePath: string;
}

interface CompilerWorkerResponse {
  id: string;
  ok: boolean;
  pdf?: Uint8Array;
  compilationLog?: string;
  error?: string;
}

interface CompilerWorkerLike {
  postMessage(message: CompilerWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CompilerWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

function compilerWorker(): CompilerWorkerLike {
  return new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' });
}

function sourceIsSafe(source: string): boolean {
  if (source.includes('\u0000')) return false;
  const forbidden = /\\(?:write18|input|include|openin|openout|@@input)\b|(?:https?:|file:|\.\.\/)/i;
  return !forbidden.test(source);
}

export function validateLatexSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) throw new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'The document source is empty.');
  if (normalized.length > ARTIFACT_LIMITS.maxGeneratedSourceCharacters) throw new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'The document source is too large.');
  if (!sourceIsSafe(normalized)) throw new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'The document source contains a blocked file or execution directive.');
  return normalized;
}

export async function compilePdf(source: string, options: { timeoutMs?: number; basePath?: string } = {}): Promise<CompilePdfResult> {
  const validated = validateLatexSource(source);
  const worker = compilerWorker();
  const id = crypto.randomUUID();
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? ARTIFACT_LIMITS.maxCompilerDurationMs, ARTIFACT_LIMITS.maxCompilerDurationMs));
  const basePath = options.basePath ?? (import.meta.env.VITE_BUSYTEX_BASE_PATH as string | undefined) ?? '/core/busytex';
  return new Promise<CompilePdfResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      callback();
    };
    const timer = window.setTimeout(() => finish(() => reject(new ArtifactError('DOCUMENT_COMPILATION_TIMEOUT', 'PDF generation timed out.'))), timeoutMs);
    worker.onmessage = (event) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      if (!event.data.ok || !event.data.pdf) {
        finish(() => reject(new ArtifactError('DOCUMENT_COMPILATION_FAILED', event.data.error ?? 'PDF generation failed.')));
        return;
      }
      const log = (event.data.compilationLog ?? '').slice(0, ARTIFACT_LIMITS.maxCompilationLogCharacters);
      const pdf = new Blob([event.data.pdf.buffer as ArrayBuffer], { type: 'application/pdf' });
      if (pdf.size > ARTIFACT_LIMITS.maxGeneratedPdfBytes) {
        finish(() => reject(new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'The generated PDF is too large.')));
        return;
      }
      finish(() => resolve({ pdf, compilationLog: log }));
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      finish(() => reject(new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'The document compiler could not start.')));
    };
    worker.postMessage({ id, source: validated, basePath });
  });
}
