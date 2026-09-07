import type { GeminiStreamEvent, GeminiUsage } from '../gemini/contracts';
import { normalizeGeminiError, type NormalizedProviderError } from '../gemini/errors';
import type { ExecutionSummary } from '../domain/chat';

// ---------------------------------------------------------------------------
// Generation state: the chat-owned lifecycle of one assistant turn.
//
// The provider translates the Gemini wire protocol into canonical
// `GeminiStreamEvent`s. This module consumes ONLY those normalized events and
// reduces them into `GenerationState` for the live UI. It never parses SSE,
// never touches the SDK, and never persists anything.
//
// Key distinction: one generation (user turn) may span MANY provider
// interactions (tool continuations). A new `interaction-created` event must
// never reset transcript or trace state. Stale events from a superseded
// generation are ignored.
// ---------------------------------------------------------------------------

/** Idle gap with no stream activity before the runner fails the turn. */
export const DEFAULT_IDLE_STALL_TIMEOUT_MS = 45_000;
/** Absolute wall-clock bound for one turn, even when actively streaming. */
export const DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS = 15 * 60_000;
/** Cap on persisted thought-summary text to protect the local store. */
export const MAX_PERSISTED_THOUGHT_SUMMARY_CHARS = 8_000;

export type GenerationPhase =
  | 'connecting'
  | 'thinking'
  | 'tool-working'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GenerationStepKind = 'thinking' | 'tool' | 'generation' | 'status';
export type GenerationStepState = 'running' | 'done' | 'failed' | 'cancelled';

export interface GenerationStep {
  id: string;
  kind: GenerationStepKind;
  label: string;
  stepIndex?: number;
  /** Monotonic ms (performance.now basis) when the step started. */
  startedAt: number;
  /** Monotonic ms when the step froze; absent while running. */
  endedAt?: number;
  state: GenerationStepState;
  /** Accumulated thought-summary text (thinking steps only). */
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  errorCode?: string;
}

export interface GenerationState {
  generationId: string;
  supersedesGenerationId?: string;
  phase: GenerationPhase;
  model?: string;
  /** Every provider interaction observed in this turn, in order. */
  interactionIds: string[];
  currentInteractionId?: string;
  /** Monotonic ms (performance.now basis) when the turn started. */
  startedAt: number;
  /** Monotonic ms from turn start to the first stream event. */
  timeToFirstEventMs?: number;
  /** Monotonic ms when the turn reached a terminal phase. */
  endedAt?: number;
  /** Full assistant transcript accumulated across all interactions. */
  transcript: string;
  steps: GenerationStep[];
  activeTool?: { name: string; callId: string; stepId: string };
  statusMessage?: string;
  usage?: GeminiUsage;
  error?: NormalizedProviderError;
  nextStepSequence: number;
}

export interface GenerationEventEnvelope {
  generationId: string;
  event: GeminiStreamEvent;
  /** Monotonic ms (performance.now basis) when the runner received the event. */
  receivedAt: number;
}

const TERMINAL_PHASES: ReadonlySet<GenerationPhase> = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_PHASES: ReadonlySet<GenerationPhase> = new Set(['connecting', 'thinking', 'tool-working', 'generating']);
/** Tool-loop status vocabulary that means "tool work is in flight". */
const TOOL_ACTIVITY_STATUSES: ReadonlySet<string> = new Set(['executing_tools', 'awaiting_tool_confirmation', 'awaiting_authorization']);

export function isTerminalPhase(phase: GenerationPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function isActivePhase(phase: GenerationPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export function createGenerationState(
  generationId: string,
  options: { supersedesGenerationId?: string; startedAt: number } = { startedAt: 0 },
): GenerationState {
  return {
    generationId,
    supersedesGenerationId: options.supersedesGenerationId,
    phase: 'connecting',
    interactionIds: [],
    startedAt: options.startedAt,
    transcript: '',
    steps: [],
    nextStepSequence: 0,
  };
}

function classifyStepType(rawStepType: string): GenerationStepKind {
  const normalized = rawStepType.trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'thought' || normalized === 'thinking' || normalized === 'thought_summary' || normalized === 'reasoning') {
    return 'thinking';
  }
  if (normalized === 'function_call' || normalized === 'tool_call' || normalized === 'tool' || normalized === 'function') {
    return 'tool';
  }
  if (
    normalized === 'model_output' ||
    normalized === 'output' ||
    normalized === 'text' ||
    normalized === 'message' ||
    normalized === 'content' ||
    normalized === 'response'
  ) {
    return 'generation';
  }
  return 'status';
}

function defaultStepLabel(kind: GenerationStepKind, index: number): string {
  if (kind === 'thinking') return 'Thinking';
  if (kind === 'tool') return 'Calling tool…';
  if (kind === 'generation') return 'Writing';
  return `Step ${index}`;
}

function phaseForStepKind(kind: GenerationStepKind): GenerationPhase | undefined {
  if (kind === 'thinking') return 'thinking';
  if (kind === 'tool') return 'tool-working';
  if (kind === 'generation') return 'generating';
  return undefined;
}

function lastRunningStepIndex(steps: readonly GenerationStep[], stepIndex?: number): number {
  if (stepIndex !== undefined) {
    for (let cursor = steps.length - 1; cursor >= 0; cursor -= 1) {
      if (steps[cursor].state === 'running' && steps[cursor].stepIndex === stepIndex) return cursor;
    }
  }
  for (let cursor = steps.length - 1; cursor >= 0; cursor -= 1) {
    if (steps[cursor].state === 'running') return cursor;
  }
  return -1;
}

function lastRunningStepOfKind(steps: readonly GenerationStep[], kind: GenerationStepKind, stepIndex?: number): number {
  if (stepIndex !== undefined) {
    for (let cursor = steps.length - 1; cursor >= 0; cursor -= 1) {
      if (steps[cursor].state === 'running' && steps[cursor].kind === kind && steps[cursor].stepIndex === stepIndex) return cursor;
    }
  }
  for (let cursor = steps.length - 1; cursor >= 0; cursor -= 1) {
    if (steps[cursor].state === 'running' && steps[cursor].kind === kind) return cursor;
  }
  return -1;
}

function openStep(state: GenerationState, kind: GenerationStepKind, receivedAt: number, stepIndex?: number): GenerationState {
  const step: GenerationStep = {
    id: `step-${state.nextStepSequence}`,
    kind,
    label: defaultStepLabel(kind, stepIndex ?? state.nextStepSequence),
    stepIndex,
    startedAt: receivedAt,
    state: 'running',
    detail: kind === 'thinking' ? '' : undefined,
  };
  return { ...state, steps: [...state.steps, step], nextStepSequence: state.nextStepSequence + 1 };
}

function updateStepAt(state: GenerationState, position: number, update: Partial<GenerationStep>): GenerationState {
  const steps = state.steps.slice();
  steps[position] = { ...steps[position], ...update };
  return { ...state, steps };
}

/**
 * Pure reducer. Returns the SAME state reference when the envelope is stale
 * (another generation) or when the turn already reached a terminal phase.
 */
export function applyGenerationEvent(state: GenerationState, envelope: GenerationEventEnvelope): GenerationState {
  if (envelope.generationId !== state.generationId) return state;
  if (isTerminalPhase(state.phase)) return state;

  const { event, receivedAt } = envelope;
  let next: GenerationState =
    state.timeToFirstEventMs === undefined
      ? { ...state, timeToFirstEventMs: Math.max(0, receivedAt - state.startedAt) }
      : state;

  switch (event.type) {
    case 'interaction-created': {
      // A new interaction NEVER resets transcript or trace: tool continuations
      // belong to the same generation. Freeze in-flight steps from the
      // previous interaction so their timers stay honest, then continue.
      // A re-announced (duplicate) id is not a boundary: leave running steps
      // and the active tool untouched.
      const seen = next.interactionIds.includes(event.interactionId);
      const steps =
        !seen && next.steps.length > 0
          ? next.steps.map((step) =>
              step.state === 'running' ? { ...step, state: 'done' as const, endedAt: receivedAt } : step,
            )
          : next.steps;
      return {
        ...next,
        steps,
        model: next.model ?? event.model,
        interactionIds: seen ? next.interactionIds : [...next.interactionIds, event.interactionId],
        currentInteractionId: event.interactionId,
        activeTool: seen ? next.activeTool : undefined,
      };
    }
    case 'interaction-status': {
      const toolActive = TOOL_ACTIVITY_STATUSES.has(event.status);
      return {
        ...next,
        statusMessage: event.status,
        phase: toolActive ? 'tool-working' : next.phase,
      };
    }
    case 'step-start': {
      const kind = classifyStepType(event.stepType);
      const opened = openStep(next, kind, receivedAt, event.index);
      const phase = phaseForStepKind(kind);
      return phase ? { ...opened, phase } : opened;
    }
    case 'thought-summary-delta': {
      const position = lastRunningStepOfKind(next.steps, 'thinking', event.index);
      if (position < 0) {
        const opened = openStep(next, 'thinking', receivedAt, event.index);
        const created = opened.steps.length - 1;
        return {
          ...updateStepAt(opened, created, { detail: event.text }),
          phase: 'thinking',
        };
      }
      const current = next.steps[position].detail ?? '';
      return updateStepAt(next, position, { detail: `${current}${event.text}` });
    }
    case 'thought-signature': {
      // Encrypted payload: transport noise as far as the UI is concerned.
      // Never displayed, never persisted.
      return next;
    }
    case 'tool-call': {
      let withStep = next;
      let position = lastRunningStepOfKind(next.steps, 'tool', event.index);
      if (position < 0) {
        withStep = openStep(next, 'tool', receivedAt, event.index);
        position = withStep.steps.length - 1;
      }
      const stepId = withStep.steps[position].id;
      return {
        ...updateStepAt(withStep, position, {
          label: event.name,
          toolName: event.name,
          toolCallId: event.callId,
        }),
        phase: 'tool-working',
        activeTool: { name: event.name, callId: event.callId, stepId },
      };
    }
    case 'text-delta': {
      let withStep = next;
      const position =
        lastRunningStepOfKind(next.steps, 'generation', event.index) >= 0
          ? lastRunningStepOfKind(next.steps, 'generation', event.index)
          : -1;
      if (position < 0) {
        withStep = openStep(next, 'generation', receivedAt, event.index);
      }
      return { ...withStep, transcript: `${withStep.transcript}${event.text}`, phase: 'generating' };
    }
    case 'step-stop': {
      const position = lastRunningStepIndex(next.steps, event.index);
      if (position < 0) return next;
      // Tool steps stay running across the execution gap: their timer should
      // measure call → continuation, closed by the next interaction-created
      // (or by a terminal event below).
      if (next.steps[position].kind === 'tool') return next;
      return updateStepAt(next, position, { state: 'done', endedAt: receivedAt });
    }
    case 'completed': {
      const seen = next.interactionIds.includes(event.interactionId);
      return {
        ...next,
        steps: next.steps.map((step) =>
          step.state === 'running' ? { ...step, state: 'done' as const, endedAt: receivedAt } : step,
        ),
        phase: 'completed',
        endedAt: receivedAt,
        interactionIds: seen ? next.interactionIds : [...next.interactionIds, event.interactionId],
        currentInteractionId: event.interactionId,
        activeTool: undefined,
        usage: event.usage,
      };
    }
    case 'failed': {
      return failGeneration(next, event.error, receivedAt);
    }
    case 'error': {
      // Legacy vocabulary: map onto the canonical failed outcome.
      const error = event.error ?? normalizeGeminiError(new Error(event.message));
      return failGeneration(next, error, receivedAt);
    }
    case 'cancelled': {
      return {
        ...next,
        steps: next.steps.map((step) =>
          step.state === 'running' ? { ...step, state: 'cancelled' as const, endedAt: receivedAt } : step,
        ),
        phase: 'cancelled',
        endedAt: receivedAt,
        activeTool: undefined,
      };
    }
    default: {
      return next;
    }
  }
}

function failGeneration(state: GenerationState, error: NormalizedProviderError, receivedAt: number): GenerationState {
  const steps = state.steps.slice();
  const failedPosition = lastRunningStepIndex(steps);
  for (let cursor = 0; cursor < steps.length; cursor += 1) {
    if (steps[cursor].state !== 'running') continue;
    steps[cursor] =
      cursor === failedPosition
        ? { ...steps[cursor], state: 'failed', endedAt: receivedAt, errorCode: error.code }
        : { ...steps[cursor], state: 'done', endedAt: receivedAt };
  }
  return { ...state, steps, phase: 'failed', endedAt: receivedAt, activeTool: undefined, error };
}

/** Provider-supplied thought summary if present, else the accumulated live steps. */
export function thoughtSummaryOf(state: GenerationState): string | undefined {
  const providerSummary = state.usage?.thoughtSummary?.trim();
  if (providerSummary) return providerSummary;
  const summary = state.steps
    .filter((step) => step.kind === 'thinking')
    .map((step) => (step.detail ?? '').trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim();
  return summary || undefined;
}

export function toolNamesOf(state: GenerationState): string[] {
  return state.steps.filter((step) => step.kind === 'tool' && step.toolName).map((step) => step.toolName as string);
}

export function turnDurationMs(state: GenerationState, now: number): number {
  return Math.max(0, (state.endedAt ?? now) - state.startedAt);
}

export function stepElapsedMs(step: GenerationStep, now: number): number {
  return Math.max(0, (step.endedAt ?? now) - step.startedAt);
}

function describeStep(step: GenerationStep): string {
  const elapsed = Math.max(0, Math.round((step.endedAt ?? step.startedAt) - step.startedAt));
  const base =
    step.kind === 'tool' ? `Tool ${step.toolName ?? step.label}` : step.kind === 'thinking' && !(step.detail ?? '').trim()
      ? 'Thinking (no summary)'
      : step.label;
  if (step.state === 'failed') return `${base} · failed after ${elapsed} ms`;
  if (step.state === 'cancelled') return `${base} · stopped after ${elapsed} ms`;
  if (step.state === 'running') return `${base} · running ${elapsed} ms`;
  return `${base} · ${elapsed} ms`;
}

/**
 * Fold ephemeral trace state into the durable per-message summary.
 * Only call at terminal time; never persists transient phase labels.
 */
export function buildExecutionSummary(state: GenerationState): ExecutionSummary {
  const summary = thoughtSummaryOf(state);
  return {
    id: state.generationId,
    steps: state.steps.map(describeStep),
    durationMs: Math.max(0, Math.round((state.endedAt ?? state.startedAt) - state.startedAt)),
    thoughtSummary:
      summary && summary.length > MAX_PERSISTED_THOUGHT_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_PERSISTED_THOUGHT_SUMMARY_CHARS)}…`
        : summary,
  };
}

/** Runner-synthesized timeout failure (watchdog fired, no provider event). */
export function generationTimeoutError(
  message: string,
  context: { interactionId?: string; durationMs?: number } = {},
): NormalizedProviderError {
  return normalizeGeminiError(new Error(message), { ...context, category: 'timeout' });
}

/** Runner-synthesized protocol failure (stream exhausted without a terminal event). */
export function generationProtocolError(
  message: string,
  context: { interactionId?: string; durationMs?: number } = {},
): NormalizedProviderError {
  return normalizeGeminiError(new Error(message), { ...context, category: 'provider' });
}
