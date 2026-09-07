import { describe, expect, it } from 'vitest';
import type { GeminiStreamEvent } from '../gemini/contracts';
import {
  applyGenerationEvent,
  buildExecutionSummary,
  createGenerationState,
  isActivePhase,
  isTerminalPhase,
  stepElapsedMs,
  thoughtSummaryOf,
  toolNamesOf,
  turnDurationMs,
  type GenerationState,
} from './generation-state';

function drive(events: GeminiStreamEvent[], generationId = 'gen-1', startAt = 1000, stepMs = 100): GenerationState {
  let state = createGenerationState(generationId, { startedAt: startAt });
  events.forEach((event, position) => {
    state = applyGenerationEvent(state, { generationId, event, receivedAt: startAt + (position + 1) * stepMs });
  });
  return state;
}

describe('generation-state reducer', () => {
  it('walks the canonical lifecycle: connecting → thinking → generating → completed', () => {
    const state = drive([
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-summary-delta', index: 0, text: 'Considering the request.' },
      { type: 'step-stop', index: 0 },
      { type: 'step-start', index: 1, stepType: 'model_output' },
      { type: 'text-delta', index: 1, text: 'Hello' },
      { type: 'text-delta', index: 1, text: ' there.' },
      { type: 'step-stop', index: 1 },
      { type: 'completed', interactionId: 'interaction-1', status: 'completed', durationMs: 900 },
    ]);

    expect(state.phase).toBe('completed');
    expect(state.transcript).toBe('Hello there.');
    expect(state.interactionIds).toEqual(['interaction-1']);
    expect(state.steps.map((step) => step.label)).toEqual(['Thinking', 'Writing']);
    expect(state.steps.every((step) => step.state === 'done' && step.endedAt !== undefined)).toBe(true);
    expect(isTerminalPhase(state.phase)).toBe(true);
    expect(isActivePhase('thinking')).toBe(true);
  });

  it('accumulates interactions without resetting transcript or trace (tool continuation)', () => {
    const state = drive([
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-summary-delta', index: 0, text: 'I should check the calendar.' },
      { type: 'step-stop', index: 0 },
      { type: 'text-delta', index: 1, text: 'Let me look that up. ' },
      { type: 'step-start', index: 2, stepType: 'function_call' },
      { type: 'tool-call', interactionId: 'interaction-1', index: 2, callId: 'call-1', name: 'calendar.listEvents', arguments: {} },
      { type: 'step-stop', index: 2 },
      // Tool continuation: same generation, new interaction.
      { type: 'interaction-created', interactionId: 'interaction-2', model: 'gemini-3.8-flash' },
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-summary-delta', index: 0, text: 'The calendar has one event.' },
      { type: 'step-stop', index: 0 },
      { type: 'text-delta', index: 1, text: 'You have a design review.' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 1400 },
    ]);

    // Criterion: same generation ≠ same interaction.
    expect(state.interactionIds).toEqual(['interaction-1', 'interaction-2']);
    expect(state.transcript).toBe('Let me look that up. You have a design review.');
    expect(state.steps).toHaveLength(5);
    expect(toolNamesOf(state)).toEqual(['calendar.listEvents']);
    expect(state.phase).toBe('completed');
    expect(thoughtSummaryOf(state)).toBe('I should check the calendar.\n\nThe calendar has one event.');
  });

  it('keeps the tool step running until the continuation arrives, then freezes its timer', () => {
    let state = createGenerationState('gen-tool', { startedAt: 0 });
    const send = (event: GeminiStreamEvent, receivedAt: number) => {
      state = applyGenerationEvent(state, { generationId: 'gen-tool', event, receivedAt });
    };
    send({ type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    send({ type: 'step-start', index: 0, stepType: 'function_call' }, 20);
    send({ type: 'tool-call', interactionId: 'i-1', index: 0, callId: 'c-1', name: 'tasks.createTask', arguments: {} }, 30);
    expect(state.phase).toBe('tool-working');
    expect(state.activeTool).toMatchObject({ name: 'tasks.createTask', callId: 'c-1' });

    send({ type: 'step-stop', index: 0 }, 40);
    // step-stop does NOT close tool steps: execution is still in flight.
    expect(state.steps[0].state).toBe('running');
    expect(state.steps[0].endedAt).toBeUndefined();

    send({ type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_tool_confirmation' }, 50);
    expect(state.phase).toBe('tool-working');

    send({ type: 'interaction-created', interactionId: 'i-2', model: 'm' }, 100);
    // Continuation arrival closes the round trip and clears the active tool.
    expect(state.steps[0].state).toBe('done');
    expect(state.steps[0].endedAt).toBe(100);
    expect(stepElapsedMs(state.steps[0], 100)).toBe(80);
    expect(state.activeTool).toBeUndefined();
  });

  it('ignores stale events from superseded generations by reference', () => {
    const state = drive([{ type: 'text-delta', index: 0, text: 'abc' }], 'gen-active');
    const stale = applyGenerationEvent(state, {
      generationId: 'gen-superseded',
      event: { type: 'text-delta', index: 0, text: 'STALE' },
      receivedAt: 9999,
    });
    expect(stale).toBe(state);
    expect(stale.transcript).toBe('abc');
  });

  it('treats terminal phases as terminal: later events are ignored', () => {
    const state = drive([
      { type: 'text-delta', index: 0, text: 'Done.' },
      { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 10 },
    ]);
    const later = applyGenerationEvent(state, {
      generationId: state.generationId,
      event: { type: 'text-delta', index: 0, text: 'LOST' },
      receivedAt: 9999,
    });
    expect(later).toBe(state);
    expect(later.transcript).toBe('Done.');
  });

  it('records time-to-first-event and turn duration', () => {
    const state = drive(
      [
        { type: 'interaction-created', interactionId: 'i-1', model: 'm' },
        { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
      ],
      'gen-timing',
      1000,
      250,
    );
    expect(state.timeToFirstEventMs).toBe(250);
    expect(state.endedAt).toBe(1500);
    expect(turnDurationMs(state, 9999)).toBe(500);
  });

  it('stores structured failures and marks the in-flight step failed', () => {
    const state = drive([
      { type: 'interaction-created', interactionId: 'i-1', model: 'm' },
      { type: 'step-start', index: 0, stepType: 'thought' },
      {
        type: 'failed',
        error: {
          category: 'rate_limit',
          code: 'GEMINI_RATE_LIMIT',
          message: 'Slow down.',
          retryable: true,
          cancelled: false,
          providerStatus: 429,
          debug: {},
        },
      },
    ]);
    expect(state.phase).toBe('failed');
    expect(state.error).toMatchObject({ code: 'GEMINI_RATE_LIMIT', retryable: true, providerStatus: 429 });
    expect(state.steps[0].state).toBe('failed');
    expect(state.steps[0].errorCode).toBe('GEMINI_RATE_LIMIT');
  });

  it('freezes running steps as cancelled on cancellation', () => {
    const state = drive([
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-summary-delta', index: 0, text: 'Partial thought.' },
      { type: 'cancelled', interactionId: 'i-1' },
    ]);
    expect(state.phase).toBe('cancelled');
    expect(state.steps[0].state).toBe('cancelled');
    expect(state.error).toBeUndefined();
  });

  it('never stores thought signatures', () => {
    const state = drive([
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-signature', index: 0, signature: 'encrypted-blob-must-not-persist' },
      { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
    ]);
    expect(JSON.stringify(state)).not.toContain('encrypted-blob');
  });

  it('creates defensive steps for deltas that arrive without step-start', () => {
    const state = drive([
      { type: 'thought-summary-delta', index: 3, text: 'Orphan thought.' },
      { type: 'text-delta', index: 4, text: 'Orphan text.' },
    ]);
    expect(state.steps.map((step) => step.kind)).toEqual(['thinking', 'generation']);
    expect(state.transcript).toBe('Orphan text.');
    expect(thoughtSummaryOf(state)).toBe('Orphan thought.');
  });

  it('surfaces unknown provider step types as generic status steps', () => {
    const state = drive([{ type: 'step-start', index: 7, stepType: 'mystery_future_step' }]);
    expect(state.steps[0]).toMatchObject({ kind: 'status', label: 'Step 7', state: 'running' });
    expect(state.phase).toBe('connecting');
  });

  it('prefers the provider authoritative thought summary on completion', () => {
    const state = drive([
      { type: 'thought-summary-delta', index: 0, text: 'live-partial' },
      {
        type: 'completed',
        interactionId: 'i-1',
        status: 'completed',
        durationMs: 5,
        usage: { inputTokens: 10, outputTokens: 5, thoughtSummary: 'authoritative summary' },
      },
    ]);
    expect(thoughtSummaryOf(state)).toBe('authoritative summary');
    expect(state.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('builds a durable execution summary without transient labels', () => {
    const state = drive(
      [
        { type: 'interaction-created', interactionId: 'i-1', model: 'm' },
        { type: 'step-start', index: 0, stepType: 'thought' },
        { type: 'thought-summary-delta', index: 0, text: 'Why we did it.' },
        { type: 'step-stop', index: 0 },
        { type: 'step-start', index: 1, stepType: 'function_call' },
        { type: 'tool-call', interactionId: 'i-1', index: 1, callId: 'c-1', name: 'calendar.listEvents', arguments: {} },
        { type: 'step-stop', index: 1 },
        { type: 'interaction-created', interactionId: 'i-2', model: 'm' },
        { type: 'text-delta', index: 0, text: 'Answer.' },
        { type: 'completed', interactionId: 'i-2', status: 'completed', durationMs: 50 },
      ],
      'gen-summary',
      0,
      100,
    );
    const summary = buildExecutionSummary(state);
    expect(summary.id).toBe('gen-summary');
    expect(summary.durationMs).toBe(1000);
    expect(summary.thoughtSummary).toBe('Why we did it.');
    expect(summary.steps).toEqual([
      'Thinking · 200 ms',
      'Tool calendar.listEvents · 300 ms',
      'Writing · 100 ms',
    ]);
    expect(summary.steps.join(' ')).not.toMatch(/Thinking\.\.\.|Writing\.\.\./);
  });
});
