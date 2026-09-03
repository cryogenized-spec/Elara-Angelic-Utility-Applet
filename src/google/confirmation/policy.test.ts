import { describe, expect, it } from 'vitest';
import { evaluateWriteConfirmation, isConfirmationFresh } from './policy';

describe('write confirmation policy', () => {
  it('never requires confirmation for reads', () => {
    expect(evaluateWriteConfirmation('read')).toEqual({ requiresConfirmation: false, reason: 'read-only' });
  });

  it('requires confirmation for writes, destructive actions, and sends', () => {
    expect(evaluateWriteConfirmation('write').requiresConfirmation).toBe(true);
    expect(evaluateWriteConfirmation('destructive').requiresConfirmation).toBe(true);
    expect(evaluateWriteConfirmation('send').requiresConfirmation).toBe(true);
  });

  it('expires confirmations after a bounded window', () => {
    const now = new Date('2026-09-03T06:00:00.000Z');
    expect(isConfirmationFresh('2026-09-03T05:56:00.000Z', now)).toBe(true);
    expect(isConfirmationFresh('2026-09-03T05:54:59.000Z', now)).toBe(false);
    expect(isConfirmationFresh('2026-09-03T06:01:00.000Z', now)).toBe(false);
  });
});
