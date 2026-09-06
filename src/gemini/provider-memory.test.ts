import { beforeEach, describe, expect, it } from 'vitest';
import { appendMemoryContext, loadMemoryContextSafely } from './memory-context';

describe('Gemini durable-memory integration boundary', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the master instruction intact while appending application context', () => {
    const result = appendMemoryContext('ELARA MASTER INSTRUCTION', 'Relevant durable memories.\n- [CORE] Prefer dark mode.');
    expect(result.startsWith('ELARA MASTER INSTRUCTION')).toBe(true);
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(result).toContain('[CORE] Prefer dark mode.');
  });

  it('returns no memory projection when there is no active thread', async () => {
    await expect(loadMemoryContextSafely('test query')).resolves.toBe('');
  });
});
