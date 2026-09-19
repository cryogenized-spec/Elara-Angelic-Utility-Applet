import { describe, expect, it } from 'vitest';
import type { GeminiStreamEvent } from '../gemini/contracts';
import {
  MAX_PERSISTED_THOUGHT_SUMMARY_CHARS,
  applyGenerationEvent,
  buildGenerationActivity,
  createGenerationState,
  isActivePhase,
  isTerminalPhase,
  persistedThoughtSummaryOf,
  stepElapsedMs,
  thoughtSummaryOf,
  toolNamesOf,
  turnDurationMs,
  type GenerationState,
} from './generation-state';
import { GEMINI_STREAM_LIMITS } from '../gemini/stream-limits';

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
      { type: 'interaction-created', interactionId: 'interaction-2', model: 'gemini-3.8-flash' },
      { type: 'step-start', index: 0, stepType: 'thought' },
      { type: 'thought-summary-delta', index: 0, text: 'The calendar has one event.' },
      { type: 'step-stop', index: 0 },
      { type: 'text-delta', index: 1, text: 'You have a design review.' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 1400 },
    ]);

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
    expect(state.steps[0].state).toBe('running');
    expect(state.steps[0].endedAt).toBeUndefined();

    send({ type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_tool_confirmation' }, 50);
    expect(state.phase).toBe('tool-working');

    send({ type: 'interaction-created', interactionId: 'i-2', model: 'm' }, 100);
    expect(state.steps[0].state).toBe('done');
    expect(state.steps[0].endedAt).toBe(100);
    expect(stepElapsedMs(state.steps[0], 100)).toBe(80);
    expect(state.activeTool).toBeUndefined();
  });

  it('holds tool work open across status heartbeats until the continuation lands', () => {
    let state = createGenerationState('gen-status-gap', { startedAt: 0 });
    const send = (event: GeminiStreamEvent, receivedAt: number) => {
      state = applyGenerationEvent(state, { generationId: 'gen-status-gap', event, receivedAt });
    };
    send({ type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    send({ type: 'text-delta', index: 0, text: 'Working on it. ' }, 20);
    send({ type: 'step-start', index: 1, stepType: 'function_call' }, 30);
    send({ type: 'tool-call', interactionId: 'i-1', index: 1, callId: 'c-1', name: 'tasks.createTask', arguments: {} }, 40);
    send({ type: 'step-stop', index: 1 }, 50);
    send({ type: 'interaction-status', interactionId: 'i-1', status: 'executing_tools' }, 60);
    expect(state.phase).toBe('tool-working');
    send({ type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_tool_confirmation' }, 70);
    send({ type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_tool_confirmation' }, 80);
    expect(state.phase).toBe('tool-working');
    expect(state.statusMessage).toBe('awaiting_tool_confirmation');
    expect(state.steps.find((step) => step.kind === 'tool')?.state).toBe('running');

    send({ type: 'interaction-created', interactionId: 'i-2', model: 'm' }, 100);
    const toolStep = state.steps.find((step) => step.kind === 'tool');
    if (!toolStep) throw new Error('expected a tool step in the trace');
    expect(toolStep.state).toBe('done');
    expect(stepElapsedMs(toolStep, 100)).toBe(70);
    expect(state.activeTool).toBeUndefined();
    expect(state.transcript).toBe('Working on it. ');

    send({ type: 'text-delta', index: 0, text: 'Task created.' }, 110);
    send({ type: 'completed', interactionId: 'i-2', status: 'completed', durationMs: 5 }, 120);
    expect(state.phase).toBe('completed');
    expect(state.interactionIds).toEqual(['i-1', 'i-2']);
    expect(state.transcript).toBe('Working on it. Task created.');
  });

  it('ignores a re-announced interaction id instead of freezing live steps', () => {
    let state = createGenerationState('gen-dup', { startedAt: 0 });
    const send = (event: GeminiStreamEvent, receivedAt: number) => {
      state = applyGenerationEvent(state, { generationId: 'gen-dup', event, receivedAt });
    };
    send({ type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    send({ type: 'step-start', index: 0, stepType: 'thought' }, 20);
    send({ type: 'tool-call', interactionId: 'i-1', index: 1, callId: 'c-1', name: 'tasks.createTask', arguments: {} }, 30);
    expect(state.activeTool?.name).toBe('tasks.createTask');

    send({ type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 40);
    expect(state.interactionIds).toEqual(['i-1']);
    expect(state.steps.every((step) => step.state === 'running')).toBe(true);
    expect(state.activeTool?.name).toBe('tasks.createTask');

    send({ type: 'interaction-created', interactionId: 'i-2', model: 'm' }, 50);
    expect(state.interactionIds).toEqual(['i-1', 'i-2']);
    expect(state.steps.every((step) => step.state === 'done')).toBe(true);
    expect(state.activeTool).toBeUndefined();
  });

  it('caps only the persisted provider summary and leaves live provider text intact', () => {
    const state = drive(
      [
        { type: 'thought-summary-delta', index: 0, text: 'x'.repeat(9000) },
        { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
      ],
      'gen-truncate',
    );
    expect(thoughtSummaryOf(state)?.length).toBe(9000);
    const persisted = persistedThoughtSummaryOf(state);
    expect(persisted?.length).toBe(MAX_PERSISTED_THOUGHT_SUMMARY_CHARS + 1);
    expect(persisted?.endsWith('…')).toBe(true);
  });

  it('records used memory as context activity without turning it into a tool', () => {
    const state = drive([
      { type: 'context-activity', category: 'memory', label: 'Memory', detail: 'Recalled relevant durable memory.', durationMs: 37, outcome: 'used' },
      { type: 'interaction-created', interactionId: 'i-1', model: 'm' },
      { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
    ]);
    expect(state.steps[0]).toMatchObject({ kind: 'context', contextCategory: 'memory', state: 'done', detail: 'Recalled relevant durable memory.' });
    expect(toolNamesOf(state)).toEqual([]);
    expect(buildGenerationActivity(state).steps[0]).toMatchObject({ kind: 'context', contextCategory: 'memory', durationMs: 37 });
  });

  it('records unavailable memory as a failed context row but does not fail the turn', () => {
    const state = drive([
      { type: 'context-activity', category: 'memory', label: 'Memory', detail: 'Memory retrieval was unavailable; continued without it.', durationMs: 12, outcome: 'unavailable' },
      { type: 'text-delta', index: 0, text: 'Still answered.' },
      { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
    ]);
    expect(state.phase).toBe('completed');
    expect(state.transcript).toBe('Still answered.');
    expect(state.steps[0]).toMatchObject({ kind: 'context', state: 'failed', errorCode: 'CONTEXT_UNAVAILABLE' });
  });

  it('does not add empty memory lookups to the user-visible activity record', () => {
    const state = drive([
      { type: 'context-activity', category: 'memory', label: 'Memory', durationMs: 5, outcome: 'empty' },
      { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 5 },
    ]);
    expect(state.steps).toEqual([]);
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

  it('builds one durable activity record from the same live steps', () => {
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
    const activity = buildGenerationActivity(state);
    expect(activity).toEqual({
      id: 'gen-summary',
      durationMs: 1000,
      steps: [
        { id: 'step-0', kind: 'thinking', state: 'done', durationMs: 200, label: 'Thinking' },
        { id: 'step-1', kind: 'tool', state: 'done', durationMs: 300, label: 'calendar.listEvents', toolName: 'calendar.listEvents' },
        { id: 'step-2', kind: 'generation', state: 'done', durationMs: 100, label: 'Writing' },
      ],
    });
    expect(persistedThoughtSummaryOf(state)).toBe('Why we did it.');
  });
});


describe('live generation resource ceilings', () => {
  it('fails the reducer before retaining oversized assistant text', () => {
    const state = createGenerationState('gen-limit', { startedAt: 0 });
    const next = applyGenerationEvent(state, {
      generationId: 'gen-limit',
      receivedAt: 1,
      event: { type: 'text-delta', index: 0, text: 'x'.repeat(GEMINI_STREAM_LIMITS.maxTextChars + 1) },
    });
    expect(next.phase).toBe('failed');
    expect(next.transcript).toBe('');
    expect(next.error?.message).toBe('Gemini response exceeded the live text safety limit.');
  });

  it('fails the reducer before retaining an oversized thought summary', () => {
    const state = createGenerationState('gen-thought-limit', { startedAt: 0 });
    const next = applyGenerationEvent(state, {
      generationId: 'gen-thought-limit',
      receivedAt: 1,
      event: { type: 'thought-summary-delta', index: 0, text: 'x'.repeat(GEMINI_STREAM_LIMITS.maxThoughtChars + 1) },
    });
    expect(next.phase).toBe('failed');
    expect(next.error?.message).toBe('Gemini thought summary exceeded the live safety limit.');
  });
});
