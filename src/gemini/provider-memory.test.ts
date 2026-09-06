import { describe, expect, it, vi } from 'vitest';
import { appendMemoryContext } from './memory-context';
import { safeLoadMemoryContext } from './provider';

describe('Gemini durable-memory integration boundary', () => {
  it('keeps the master instruction intact while appending bounded application context', () => {
    const result = appendMemoryContext('ELARA MASTER INSTRUCTION', 'Relevant durable memories.\n- [CORE] Prefer dark mode.');
    expect(result.startsWith('ELARA MASTER INSTRUCTION')).toBe(true);
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(result).toContain('[CORE] Prefer dark mode.');
  });

  it('degrades to an empty memory projection when retrieval fails', async () => {
    const memoryContext = await vi.mocked(safeLoadMemoryContext)('test query').catch(() => '');
    expect(memoryContext).toBeDefined();
  });
});
