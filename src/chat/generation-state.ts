import type { GeminiStreamEvent, GeminiUsage } from '../gemini/contracts';
import { normalizeGeminiError, type NormalizedProviderError } from '../gemini/errors';
import type { GenerationActivityRecord, GenerationActivityState, GenerationContextCategory } from '../domain/chat';
import type { MediaItem } from '../domain/media';

// ---------------------------------------------------------------------------
// Generation state: the chat-owned lifecycle of one assistant turn.
//
// The provider translates wire/application activity into canonical
// `GeminiStreamEvent`s. This module consumes only those normalized events and
// reduces them into the single GenerationState used by live UI and terminal
// persistence. It never parses SSE, touches the SDK, or writes storage.
// ---------------------------------------------------------------------------

export const DEFAULT_IDLE_STALL_TIMEOUT_MS = 45_000;
export const DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS = 15 * 60_000;
export const MAX_PERSISTED_THOUGHT_SUMMARY_CHARS = 8_000;

export type GenerationPhase =
  | 'connecting'
  | 'thinking'
  | 'tool-working'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GenerationStepKind = 'thinking' | 'tool' | 'generation' | 'context' | 'status';
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
  /** Provider-supplied thought-summary text or application-owned context detail. */
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  contextCategory?: GenerationContextCategory;
  errorCode?: string;
}

export interface GenerationState {
  generationId: string;
  supersedesGenerationId?: string;
  phase: GenerationPhase;
  model?: string;
  interactionIds: string[];
  currentInteractionId?: string;
  startedAt: number;
  timeToFirstEventMs?: number;
  endedAt?: number;
  transcript: string;
  artifactIds: string[];
  mediaItems: MediaItem[];
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
  receivedAt: number;
}

const TERMINAL_PHASES: ReadonlySet<GenerationPhase> = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_PHASES: ReadonlySet<GenerationPhase> = new Set(['connecting', 'thinking', 'tool-working', 'generating']);
const TOOL_ACTIVITY_STATUSES: ReadonlySet<string> = new Set(['executing_tools', 'awaiting_tool_confirmation', 'awaiting_authorization', 'preparing_document', 'compiling_pdf', 'finalizing_artifact']);

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
    artifactIds: [],
    mediaItems: [],
    steps: [],
    nextStepSequence: 0,
  };
}

function classifyStepType(rawStepType: string): GenerationStepKind {
  const normalized = rawStepType.trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'thought' || normalized === 'thinking' || normalized === 'thought_summary' || normalized === 'reasoning') return 'thinking';
  if (normalized === 'function_call' || normalized === 'tool_call' || normalized === 'tool' || normalized === 'function') return 'tool';
  if (normalized === 'model_output' || normalized === 'output' || normalized === 'text' || normalized === 'message' || normalized === 'content' || normalized === 'response') return 'generation';
  return 'status';
}

function defaultStepLabel(kind: GenerationStepKind, index: number): string {
  if (kind === 'thinking') return 'Thinking';
  if (kind === 'tool') return 'Calling tool';
  if (kind === 'generation') return 'Writing';
  if (kind === 'context') return 'Context';
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

export function applyGenerationEvent(state: GenerationState, envelope: GenerationEventEnvelope): GenerationState {
  if (envelope.generationId !== state.generationId) return state;
  if (isTerminalPhase(state.phase)) return state;

  const { event, receivedAt } = envelope;
  const next: GenerationState = state.timeToFirstEventMs === undefined
    ? { ...state, timeToFirstEventMs: Math.max(0, receivedAt - state.startedAt) }
    : state;

  switch (event.type) {
    case 'interaction-created': {
      const seen = next.interactionIds.includes(event.interactionId);
      const steps = !seen && next.steps.length > 0
        ? next.steps.map((step) => step.state === 'running' ? { ...step, state: 'done' as const, endedAt: receivedAt } : step)
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
      return { ...next, statusMessage: event.status, phase: toolActive ? 'tool-working' : next.phase };
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
        return { ...updateStepAt(opened, created, { detail: event.text }), phase: 'thinking' };
      }
      const current = next.steps[position].detail ?? '';
      return updateStepAt(next, position, { detail: `${current}${event.text}` });
    }
    case 'thought-signature': {
      return next;
    }
    case 'context-activity': {
      if (event.outcome === 'empty') return next;
      const durationMs = Math.max(0, event.durationMs);
      const step: GenerationStep = {
        id: `step-${next.nextStepSequence}`,
        kind: 'context',
        label: event.label,
        detail: event.detail,
        contextCategory: event.category,
        startedAt: Math.max(next.startedAt, receivedAt - durationMs),
        endedAt: receivedAt,
        state: event.outcome === 'unavailable' ? 'failed' : 'done',
        errorCode: event.outcome === 'unavailable' ? 'CONTEXT_UNAVAILABLE' : undefined,
      };
      return { ...next, steps: [...next.steps, step], nextStepSequence: next.nextStepSequence + 1 };
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
        ...updateStepAt(withStep, position, { label: event.name, toolName: event.name, toolCallId: event.callId }),
        phase: 'tool-working',
        activeTool: { name: event.name, callId: event.callId, stepId },
      };
    }
    case 'text-delta': {
      let withStep = next;
      const position = lastRunningStepOfKind(next.steps, 'generation', event.index);
      if (position < 0) withStep = openStep(next, 'generation', receivedAt, event.index);
      return { ...withStep, transcript: `${withStep.transcript}${event.text}`, phase: 'generating' };
    }
    case 'step-stop': {
      const position = lastRunningStepIndex(next.steps, event.index);
      if (position < 0) return next;
      if (next.steps[position].kind === 'tool') return next;
      return updateStepAt(next, position, { state: 'done', endedAt: receivedAt });
    }
    case 'artifact-created': {
      return next.artifactIds.includes(event.artifactId) ? next : { ...next, artifactIds: [...next.artifactIds, event.artifactId] };
    }
    case 'media-resolved': {
      const seen = new Set(next.mediaItems.map((item) => `${item.provider}:${item.id}`));
      const added = event.items.filter((item) => !seen.has(`${item.provider}:${item.id}`));
      return added.length ? { ...next, mediaItems: [...next.mediaItems, ...added] } : next;
    }
    case 'completed': {
      const seen = next.interactionIds.includes(event.interactionId);
      return {
        ...next,
        steps: next.steps.map((step) => step.state === 'running' ? { ...step, state: 'done' as const, endedAt: receivedAt } : step),
        phase: 'completed',
        endedAt: receivedAt,
        interactionIds: seen ? next.interactionIds : [...next.interactionIds, event.interactionId],
        currentInteractionId: event.interactionId,
        activeTool: undefined,
        usage: event.usage,
      };
    }
    case 'failed': return failGeneration(next, event.error, receivedAt);
    case 'error': return failGeneration(next, event.error ?? normalizeGeminiError(new Error(event.message)), receivedAt);
    case 'cancelled': {
      return {
        ...next,
        steps: next.steps.map((step) => step.state === 'running' ? { ...step, state: 'cancelled' as const, endedAt: receivedAt } : step),
        phase: 'cancelled',
        endedAt: receivedAt,
        activeTool: undefined,
      };
    }
    default: return next;
  }
}

function failGeneration(state: GenerationState, error: NormalizedProviderError, receivedAt: number): GenerationState {
  const steps = state.steps.slice();
  const failedPosition = lastRunningStepIndex(steps);
  for (let cursor = 0; cursor < steps.length; cursor += 1) {
    if (steps[cursor].state !== 'running') continue;
    steps[cursor] = cursor === failedPosition
      ? { ...steps[cursor], state: 'failed', endedAt: receivedAt, errorCode: error.code }
      : { ...steps[cursor], state: 'done', endedAt: receivedAt };
  }
  return { ...state, steps, phase: 'failed', endedAt: receivedAt, activeTool: undefined, error };
}

/** Provider-supplied summary when present, otherwise accumulated summary deltas. */
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

export function persistedThoughtSummaryOf(state: GenerationState): string | undefined {
  const summary = thoughtSummaryOf(state);
  if (!summary) return undefined;
  return summary.length > MAX_PERSISTED_THOUGHT_SUMMARY_CHARS
    ? `${summary.slice(0, MAX_PERSISTED_THOUGHT_SUMMARY_CHARS)}…`
    : summary;
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

function durableStepState(state: GenerationStepState): GenerationActivityState {
  return state === 'failed' || state === 'cancelled' ? state : 'done';
}

/**
 * Terminal snapshot of the exact same lifecycle the live panel renders.
 * No separate summary reconstruction and no raw hidden reasoning payloads.
 */
export function buildGenerationActivity(state: GenerationState): GenerationActivityRecord {
  const terminalAt = state.endedAt ?? state.startedAt;
  return {
    id: state.generationId,
    durationMs: Math.max(0, Math.round(terminalAt - state.startedAt)),
    steps: state.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      state: durableStepState(step.state),
      durationMs: Math.max(0, Math.round((step.endedAt ?? terminalAt) - step.startedAt)),
      label: step.label,
      ...(step.kind === 'context' && step.detail ? { detail: step.detail } : {}),
      ...(step.toolName ? { toolName: step.toolName } : {}),
      ...(step.contextCategory ? { contextCategory: step.contextCategory } : {}),
      ...(step.errorCode ? { errorCode: step.errorCode } : {}),
    })),
  };
}

export function generationTimeoutError(
  message: string,
  context: { interactionId?: string; durationMs?: number } = {},
): NormalizedProviderError {
  return normalizeGeminiError(new Error(message), { ...context, category: 'timeout' });
}

export function generationProtocolError(
  message: string,
  context: { interactionId?: string; durationMs?: number } = {},
): NormalizedProviderError {
  return normalizeGeminiError(new Error(message), { ...context, category: 'provider' });
}
