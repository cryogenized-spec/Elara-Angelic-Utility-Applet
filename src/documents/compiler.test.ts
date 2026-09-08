import { describe, expect, it } from 'vitest';
import { compilePdf, validateLatexSource, type CompilerWorkerLike } from './compiler';

class FakeCompilerWorker implements CompilerWorkerLike {
  onmessage: ((event: MessageEvent<{ id: string; ok: boolean; pdf?: Uint8Array; compilationLog?: string; error?: string }>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  requestId = '';
  postMessage(message: { id: string }): void { this.requestId = message.id; }
  terminate(): void { this.terminated = true; }
  lateSuccess(): void { this.onmessage?.({ data: { id: this.requestId, ok: true, pdf: new Uint8Array([1, 2, 3]), compilationLog: 'late' } } as unknown as MessageEvent<{ id: string; ok: boolean; pdf?: Uint8Array; compilationLog?: string; error?: string }>); }
}

const source = '\\documentclass{article}\\begin{document}Hello\\end{document}';

describe('document compiler validation and lifecycle', () => {
  it('accepts bounded LaTeX source', () => { expect(validateLatexSource(source)).toContain('documentclass'); });
  it('rejects empty, oversized, and execution/path directives', () => {
    expect(() => validateLatexSource('')).toThrow();
    expect(() => validateLatexSource('\\write18{whoami}')).toThrow();
    expect(() => validateLatexSource('\\input{../secret}')).toThrow();
  });
  it('terminates and detaches a worker on cancellation so late success cannot resolve', async () => {
    const worker = new FakeCompilerWorker();
    const controller = new AbortController();
    const pending = compilePdf(source, { signal: controller.signal, workerFactory: () => worker });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    worker.lateSuccess();
  });
  it('terminates and detaches a worker after timeout', async () => {
    const worker = new FakeCompilerWorker();
    await expect(compilePdf(source, { timeoutMs: 1_000, workerFactory: () => worker })).rejects.toMatchObject({ code: 'DOCUMENT_COMPILATION_TIMEOUT' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
  }, 5_000);
});
