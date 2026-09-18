import { describe, expect, it } from 'vitest';
import {
  MAX_PERSISTED_ACTIVITY_DETAIL_CHARS,
  MAX_PERSISTED_ACTIVITY_ERROR_CODE_CHARS,
  MAX_PERSISTED_ACTIVITY_LABEL_CHARS,
  MAX_PERSISTED_ACTIVITY_STEPS,
  MAX_PERSISTED_ACTIVITY_TOOL_NAME_CHARS,
  applyGenerationEvent,
  buildGenerationActivity,
  createGenerationState,
  type GenerationState,
} from './generation-state';

function send(state: GenerationState, event: Parameters<typeof applyGenerationEvent>[1]['event'], receivedAt: number): GenerationState {
  return applyGenerationEvent(state, { generationId: state.generationId, event, receivedAt });
}

describe('Pass 8 durable Generation Activity bounds', () => {
  it('never persists tool arguments or call IDs', () => {
    let state = createGenerationState('gen-private', { startedAt: 0 });
    state = send(state, { type: 'tool-call', interactionId: 'i-1', index: 0, callId: 'secret-call-id', name: 'calendar.listEvents', arguments: { accessToken: 'TOP-SECRET-TOKEN', query: 'private query' } }, 10);
    state = send(state, { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 20 }, 20);

    const serialized = JSON.stringify(buildGenerationActivity(state));
    expect(serialized).not.toContain('TOP-SECRET-TOKEN');
    expect(serialized).not.toContain('private query');
    expect(serialized).not.toContain('secret-call-id');
    expect(serialized).toContain('calendar.listEvents');
  });

  it('caps durable step count and all persisted diagnostic text fields', () => {
    let state = createGenerationState('gen-bounds', { startedAt: 0 });
    for (let index = 0; index < MAX_PERSISTED_ACTIVITY_STEPS + 25; index += 1) {
      state = send(state, { type: 'step-start', index, stepType: 'other' }, index * 2 + 1);
      state = send(state, { type: 'step-stop', index }, index * 2 + 2);
    }
    state = send(state, {
      type: 'context-activity',
      category: 'other',
      label: 'L'.repeat(MAX_PERSISTED_ACTIVITY_LABEL_CHARS + 50),
      detail: 'D'.repeat(MAX_PERSISTED_ACTIVITY_DETAIL_CHARS + 50),
      durationMs: 1,
      outcome: 'completed',
    }, 1000);
    state = send(state, {
      type: 'tool-call',
      interactionId: 'i-1',
      index: 999,
      callId: 'call-1',
      name: 'T'.repeat(MAX_PERSISTED_ACTIVITY_TOOL_NAME_CHARS + 50),
      arguments: {},
    }, 1001);
    state = send(state, {
      type: 'failed',
      error: {
        category: 'provider',
        code: 'E'.repeat(MAX_PERSISTED_ACTIVITY_ERROR_CODE_CHARS + 50),
        message: 'failed',
        retryable: false,
        cancelled: false,
        debug: {},
      },
    }, 1002);

    const record = buildGenerationActivity(state);
    expect(record.steps).toHaveLength(MAX_PERSISTED_ACTIVITY_STEPS);
    for (const step of record.steps) {
      expect(step.label.length).toBeLessThanOrEqual(MAX_PERSISTED_ACTIVITY_LABEL_CHARS + 1);
      if (step.detail) expect(step.detail.length).toBeLessThanOrEqual(MAX_PERSISTED_ACTIVITY_DETAIL_CHARS + 1);
      if (step.toolName) expect(step.toolName.length).toBeLessThanOrEqual(MAX_PERSISTED_ACTIVITY_TOOL_NAME_CHARS + 1);
      if (step.errorCode) expect(step.errorCode.length).toBeLessThanOrEqual(MAX_PERSISTED_ACTIVITY_ERROR_CODE_CHARS + 1);
    }
  });
});
