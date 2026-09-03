import { describe, expect, it } from 'vitest';
import { backgroundInteractionRefSchema } from './contracts';

describe('background interaction contract', () => {
  it('accepts supported lifecycle states', () => {
    expect(backgroundInteractionRefSchema.parse({
      interactionId: 'v1_abc',
      status: 'in_progress',
      createdAt: '2026-09-03T06:00:00.000Z',
    }).status).toBe('in_progress');
  });

  it('rejects unknown lifecycle states', () => {
    expect(() => backgroundInteractionRefSchema.parse({
      interactionId: 'v1_abc',
      status: 'running',
      createdAt: '2026-09-03T06:00:00.000Z',
    })).toThrow();
  });
});
