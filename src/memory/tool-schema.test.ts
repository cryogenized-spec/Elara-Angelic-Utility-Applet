import { describe, expect, it } from 'vitest';
import { validateMemoryToolArguments } from './tool-schema';

const validSave = { title: 'Preferred editor', body: 'The user explicitly asked Elara to remember that they prefer the compact editor.' };
const validReconcile = { targetRef: 'memref_1234567890abcdef', relation: 'support' as const, title: 'Supporting evidence', body: 'The user explicitly repeated the preference.' };

describe('memory tool schemas', () => {
  it('accepts the bounded deliberate-recall surface only', () => {
    expect(validateMemoryToolArguments('memory.recall', { query: 'what did they tell me about their cat' })).toEqual({ query: 'what did they tell me about their cat' });
    expect(() => validateMemoryToolArguments('memory.recall', { query: '' })).toThrow();
    expect(() => validateMemoryToolArguments('memory.recall', { query: 'x'.repeat(501) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.recall', { query: 'cat', folderId: 'spoofed' })).toThrow();
  });

  it('accepts the bounded lookup surface only', () => {
    expect(validateMemoryToolArguments('memory.lookup', { query: 'compact editor preference' })).toEqual({ query: 'compact editor preference' });
    expect(() => validateMemoryToolArguments('memory.lookup', { query: '' })).toThrow();
    expect(() => validateMemoryToolArguments('memory.lookup', { query: 'x'.repeat(501) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.lookup', { query: 'editor', folderId: 'spoofed' })).toThrow();
  });

  it('accepts the deliberate-save surface', () => {
    expect(validateMemoryToolArguments('memory.save', validSave)).toEqual(validSave);
    expect(validateMemoryToolArguments('memory.save', {
      ...validSave,
      kind: 'EPISODIC',
      confidence: 0.9,
      importance: 0.8,
      tags: ['preference', 'editor'],
    })).toMatchObject({ kind: 'EPISODIC', confidence: 0.9, importance: 0.8 });
  });

  it('rejects memory kinds that belong to observation/promotion policy', () => {
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, kind: 'CORE' })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, kind: 'MICRO_OBSERVATION' })).toThrow();
  });

  it('accepts only lookup references and bounded evidence for reconciliation', () => {
    expect(validateMemoryToolArguments('memory.reconcile', validReconcile)).toEqual(validReconcile);
    for (const relation of ['support', 'conflict', 'related', 'supersede'] as const) {
      expect(validateMemoryToolArguments('memory.reconcile', { ...validReconcile, relation })).toMatchObject({ relation });
    }
    expect(() => validateMemoryToolArguments('memory.reconcile', { ...validReconcile, relation: 'delete' })).toThrow();
    expect(() => validateMemoryToolArguments('memory.reconcile', { ...validReconcile, targetRef: 'x'.repeat(97) })).toThrow();
  });

  it('rejects oversized content and tag collections', () => {
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, title: 'x'.repeat(161) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, body: 'x'.repeat(4_001) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`) })).toThrow();
    expect(() => validateMemoryToolArguments('memory.save', { ...validSave, tags: ['x'.repeat(65)] })).toThrow();
    expect(() => validateMemoryToolArguments('memory.reconcile', { ...validReconcile, body: 'x'.repeat(4_001) })).toThrow();
  });

  it('rejects application-owned durable fields supplied by the model', () => {
    for (const field of ['id', 'source', 'conversationId', 'messageId', 'folderId', 'lifecycle', 'expiresAt', 'autonomyContext']) {
      expect(() => validateMemoryToolArguments('memory.save', { ...validSave, [field]: 'spoofed' })).toThrow();
      expect(() => validateMemoryToolArguments('memory.reconcile', { ...validReconcile, [field]: 'spoofed' })).toThrow();
    }
  });
});
