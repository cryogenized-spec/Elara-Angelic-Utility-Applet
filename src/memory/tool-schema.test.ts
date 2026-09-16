import { describe, expect, it } from 'vitest';
import { validateMemoryToolArguments } from './tool-schema';

const valid = { title: 'Preferred editor', body: 'The user explicitly asked Elara to remember that they prefer the compact editor.' };

describe('memory.save tool schema', () => {
  it('accepts the deliberate-save surface', () => {
    expect(validateMemoryToolArguments('memory.save', valid)).toEqual(valid);
    expect(validateMemoryToolArguments('memory.save', {
      ...valid,
      kind: 'EPISODIC',
      confidence: 0.9,
      importance: 0.8,
      tags: ['preference', 'editor'],
    })).toMatchObject({ kind: 'EPISODIC', confidence: 0.9, importance: 0.8 });
  });

  it('rejects memory kinds that belong to observation/promotion policy', () => {
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, kind: 'CORE' })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, kind: 'MICRO_OBSERVATION' })).toThrow();
  });

  it('rejects oversized content and tag collections', () => {
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, title: 'x'.repeat(161) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, body: 'x'.repeat(4_001) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...valid, tags: ['x'.repeat(65)] })).toThrow();
  });

  it('rejects application-owned durable fields supplied by the model', () => {
    for (const field of ['id', 'source', 'conversationId', 'messageId', 'folderId', 'lifecycle', 'expiresAt', 'autonomyContext']) {
      expect(() => validateMemoryToolArguments('memory.save', { ...valid, [field]: 'spoofed' })).toThrow();
    }
  });
});
