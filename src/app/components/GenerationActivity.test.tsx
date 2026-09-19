// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiStreamEvent } from '../../gemini/contracts';
import {
  applyGenerationEvent,
  buildGenerationActivity,
  createGenerationState,
  type GenerationState,
} from '../../chat/generation-state';
import { GenerationActivity, formatActivityDuration } from './GenerationTrace';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let now = 0;

function send(state: GenerationState, event: GeminiStreamEvent, receivedAt: number): GenerationState {
  return applyGenerationEvent(state, { generationId: state.generationId, event, receivedAt });
}

function renderLive(state: GenerationState): void {
  act(() => { root.render(<GenerationActivity generation={state} />); });
}

function primaryRows(): string[] {
  return [...container.querySelectorAll('.generation-activity__step-primary')].map((node) => node.textContent ?? '');
}

function rowTimes(): string[] {
  return [...container.querySelectorAll('.generation-activity__step-time')].map((node) => (node.textContent ?? '').replace(/^·\s*/, '').trim());
}

function headline(): string {
  return container.querySelector('.generation-activity__headline')?.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Generation Activity duration formatting', () => {
  it('uses elapsed whole milliseconds below one second', () => {
    expect(formatActivityDuration(0)).toBe('0 ms');
    expect(formatActivityDuration(438.4)).toBe('438 ms');
    expect(formatActivityDuration(999.9)).toBe('999 ms');
  });

  it('uses one decimal second from one second onward', () => {
    expect(formatActivityDuration(1000)).toBe('1.0 s');
    expect(formatActivityDuration(12749)).toBe('12.7 s');
  });

  it('never exposes a negative duration', () => {
    expect(formatActivityDuration(-25)).toBe('0 ms');
  });

  it('reports structural step counts even when measured duration is zero', () => {
    const markup = renderToStaticMarkup(<GenerationActivity record={{
      id: 'zero-duration-turn',
      durationMs: 0,
      steps: [
        { id: 'thinking', kind: 'thinking', state: 'done', durationMs: 0, label: 'Thinking' },
        { id: 'writing', kind: 'generation', state: 'done', durationMs: 0, label: 'Writing' },
      ],
    }} />);

    expect(markup).toContain('2 steps · 0 ms total');
  });

  it('keeps a sub-second live duration on the same side of the threshold after persistence', () => {
    let state = createGenerationState('gen-threshold', { startedAt: 0 });
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 0);
    state = send(state, { type: 'step-stop', index: 0 }, 999.6);
    state = send(state, { type: 'completed', interactionId: 'i-threshold', status: 'completed', durationMs: 999.6 }, 999.6);

    expect(formatActivityDuration(state.endedAt! - state.startedAt)).toBe('999 ms');
    const record = buildGenerationActivity(state);
    expect(record.durationMs).toBe(999);
    expect(record.steps[0]?.durationMs).toBe(999);

    const markup = renderToStaticMarkup(<GenerationActivity record={record} />);
    expect(markup).toContain('1 step · 999 ms total');
    expect(markup).not.toContain('1.0 s');
  });
});

describe('Generation Activity accessibility', () => {
  it('keeps the live control name stable while exposing deliberate detail timing and keyboard scrolling', () => {
    let state = createGenerationState('gen-accessible', { startedAt: 0 });
    state = send(state, { type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 20);

    now = 250;
    renderLive(state);

    const button = container.querySelector<HTMLButtonElement>('.generation-activity__header');
    const body = container.querySelector<HTMLDivElement>('.generation-activity__body');
    const time = container.querySelector<HTMLSpanElement>('.generation-activity__step-time');
    if (!button || !body || !time) throw new Error('expected the expanded live Generation Activity controls');

    expect(button.getAttribute('aria-label')).toBe('Generation activity details: Thinking');
    expect(body.tabIndex).toBe(0);
    expect(body.getAttribute('aria-label')).toBe('Generation activity details');
    expect(time.getAttribute('aria-label')).toBe('Reasoning duration 230 ms');

    now = 850;
    act(() => { vi.advanceTimersByTime(100); });
    expect(headline()).toBe('Thinking · 850 ms');
    expect(button.getAttribute('aria-label')).toBe('Generation activity details: Thinking');
  });
});

describe('Generation Activity live lifecycle', () => {
  it('advances the active step timer and freezes it when that step ends', () => {
    let state = createGenerationState('gen-live-timer', { startedAt: 0 });
    state = send(state, { type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 100);

    now = 538.4;
    renderLive(state);
    expect(primaryRows()).toEqual(['Reasoning']);
    expect(rowTimes()).toEqual(['438 ms']);

    now = 1300;
    act(() => { vi.advanceTimersByTime(100); });
    expect(rowTimes()).toEqual(['1.2 s']);

    state = send(state, { type: 'step-stop', index: 0 }, 1500);
    now = 1500;
    renderLive(state);
    expect(primaryRows()).toEqual(['Reasoning']);
    expect(rowTimes()).toEqual(['1.4 s']);

    now = 9000;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(rowTimes()).toEqual(['1.4 s']);
  });

  it('keeps thought/tool/thought/writing stages distinct with local elapsed times', () => {
    let state = createGenerationState('gen-tool-cycle', { startedAt: 0 });
    state = send(state, { type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 20);
    state = send(state, { type: 'thought-summary-delta', index: 0, text: 'I should check the calendar.' }, 30);
    state = send(state, { type: 'step-stop', index: 0 }, 100);
    state = send(state, { type: 'step-start', index: 1, stepType: 'function_call' }, 120);
    state = send(state, { type: 'tool-call', interactionId: 'i-1', index: 1, callId: 'c-1', name: 'calendar.listEvents', arguments: {} }, 130);
    state = send(state, { type: 'step-stop', index: 1 }, 140);
    state = send(state, { type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_tool_confirmation' }, 200);

    now = 250;
    renderLive(state);
    expect(headline()).toBe('Waiting for confirmation · 250 ms');
    expect(primaryRows()).toEqual(['Reasoning', 'Google Workspace · Calendar · List Events']);
    expect(rowTimes()).toEqual(['80 ms', '130 ms']);
    expect(container.textContent).toContain('Tool invocations (1)');
    expect(container.textContent).toContain('calendar.listEvents');
    expect(container.querySelectorAll('[data-activity-glyph="calendar"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-activity-glyph="confirmation"]')).toHaveLength(1);

    state = send(state, { type: 'interaction-created', interactionId: 'i-2', model: 'm' }, 300);
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 320);
    state = send(state, { type: 'thought-summary-delta', index: 0, text: 'The calendar returned one event.' }, 330);
    now = 500;
    renderLive(state);

    expect(headline()).toMatch(/^Thinking · /);
    act(() => { vi.advanceTimersByTime(100); });
    expect(headline()).toBe('Thinking · 500 ms');
    expect(primaryRows()).toEqual(['Reasoning', 'Google Workspace · Calendar · List Events', 'Reasoning']);
    expect(rowTimes()).toEqual(['80 ms', '180 ms', '180 ms']);

    state = send(state, { type: 'step-stop', index: 0 }, 600);
    state = send(state, { type: 'text-delta', index: 1, text: 'You have one event.' }, 700);
    now = 950;
    renderLive(state);

    expect(headline()).toMatch(/^Writing · /);
    act(() => { vi.advanceTimersByTime(100); });
    expect(headline()).toBe('Writing · 950 ms');
    expect(primaryRows()).toEqual(['Reasoning', 'Google Workspace · Calendar · List Events', 'Reasoning', 'Writing response']);
    expect(rowTimes()).toEqual(['80 ms', '180 ms', '280 ms', '250 ms']);
  });

  it('derives authorization instrumentation from the live provider status without creating a fake step', () => {
    let state = createGenerationState('gen-auth-status', { startedAt: 0 });
    state = send(state, { type: 'interaction-created', interactionId: 'i-auth', model: 'm' }, 10);
    state = send(state, { type: 'step-start', index: 0, stepType: 'function_call' }, 20);
    state = send(state, { type: 'tool-call', interactionId: 'i-auth', index: 0, callId: 'c-auth', name: 'drive.getFile', arguments: {} }, 30);
    state = send(state, { type: 'interaction-status', interactionId: 'i-auth', status: 'awaiting_authorization' }, 40);

    now = 80;
    renderLive(state);

    expect(headline()).toBe('Waiting for authorization · 80 ms');
    expect(container.querySelectorAll('[data-activity-glyph="authorization"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-activity-glyph="drive"]')).toHaveLength(1);
    expect(primaryRows()).toEqual(['Google Workspace · Drive · Get File']);
  });

  it('shows truthful terminal labels and freezes failed/cancelled steps', () => {
    let failed = createGenerationState('gen-failed', { startedAt: 0 });
    failed = send(failed, { type: 'interaction-created', interactionId: 'i-1', model: 'm' }, 10);
    failed = send(failed, { type: 'step-start', index: 0, stepType: 'function_call' }, 20);
    failed = send(failed, { type: 'tool-call', interactionId: 'i-1', index: 0, callId: 'c-1', name: 'tasks.createTask', arguments: {} }, 30);
    failed = send(failed, { type: 'interaction-status', interactionId: 'i-1', status: 'awaiting_authorization' }, 40);
    failed = send(failed, {
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
    }, 120);

    now = 5000;
    renderLive(failed);
    expect(headline()).toBe('Failed · 120 ms');
    expect(rowTimes()).toEqual(['100 ms']);
    expect(container.textContent).toContain('GEMINI_RATE_LIMIT');

    let cancelled = createGenerationState('gen-cancelled', { startedAt: 0 });
    cancelled = send(cancelled, { type: 'step-start', index: 0, stepType: 'thought' }, 20);
    cancelled = send(cancelled, { type: 'thought-summary-delta', index: 0, text: 'Partial thought.' }, 30);
    cancelled = send(cancelled, { type: 'cancelled', interactionId: 'i-2' }, 120);
    renderLive(cancelled);

    expect(headline()).toBe('Stopped · 120 ms');
    expect(primaryRows()).toEqual(['Reasoning stopped']);
    expect(rowTimes()).toEqual(['100 ms']);
  });
});

describe('Generation Activity human-facing presentation', () => {
  it('summarizes completed work by structural steps and tool count', () => {
    const markup = renderToStaticMarkup(<GenerationActivity record={{
      id: 'summary-counts',
      durationMs: 21100,
      steps: [
        { id: 'r1', kind: 'thinking', state: 'done', durationMs: 1100, label: 'Thinking' },
        { id: 't1', kind: 'tool', state: 'done', durationMs: 2800, label: 'roleplay_setting.list', toolName: 'roleplay_setting.list' },
        { id: 'r2', kind: 'thinking', state: 'done', durationMs: 3, label: 'Thinking' },
        { id: 't2', kind: 'tool', state: 'done', durationMs: 2700, label: 'roleplay_setting.list', toolName: 'roleplay_setting.list' },
        { id: 'r3', kind: 'thinking', state: 'done', durationMs: 3500, label: 'Thinking' },
        { id: 'w1', kind: 'generation', state: 'done', durationMs: 3600, label: 'Writing' },
      ],
    }} />);

    expect(markup).toContain('6 steps · 2 tools · 21.1 s total');
  });

  it('exposes exact tool identity without exposing arguments or call ids', () => {
    let state = createGenerationState('tool-privacy-ui', { startedAt: 0 });
    state = send(state, { type: 'step-start', index: 0, stepType: 'function_call' }, 10);
    state = send(state, {
      type: 'tool-call',
      interactionId: 'i-tool',
      index: 0,
      callId: 'SECRET-CALL-ID',
      name: 'roleplay_setting.list',
      arguments: { token: 'TOP-SECRET-TOKEN', privateQuery: 'do-not-render' },
    }, 20);
    state = send(state, { type: 'completed', interactionId: 'i-tool', status: 'completed', durationMs: 30 }, 30);

    renderLive(state);
    expect(container.textContent).toContain('Roleplay World · List');
    expect(container.textContent).toContain('roleplay_setting.list');
    expect(container.textContent).not.toContain('SECRET-CALL-ID');
    expect(container.textContent).not.toContain('TOP-SECRET-TOKEN');
    expect(container.textContent).not.toContain('do-not-render');
  });

  it('keeps streaming reasoning as plain text and renders stable terminal Markdown once', () => {
    let state = createGenerationState('markdown-summary', { startedAt: 0 });
    state = send(state, { type: 'step-start', index: 0, stepType: 'thought' }, 10);
    state = send(state, { type: 'thought-summary-delta', index: 0, text: '**Crafting response**\n\n- one\n- two' }, 20);
    now = 30;
    renderLive(state);

    expect(container.querySelector('.generation-activity__summary-body strong')).toBeNull();
    expect(container.querySelector('.generation-activity__summary-body')?.textContent).toContain('**Crafting response**');

    state = send(state, { type: 'step-stop', index: 0 }, 40);
    state = send(state, { type: 'completed', interactionId: 'i-markdown', status: 'completed', durationMs: 50 }, 50);
    now = 50;
    renderLive(state);

    expect(container.querySelector('.generation-activity__summary-body strong')?.textContent).toBe('Crafting response');
    expect([...container.querySelectorAll('.generation-activity__summary-body li')].map((node) => node.textContent)).toEqual(['one', 'two']);
  });
});
