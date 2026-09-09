import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiTurnPort, type GeminiTurnRequest } from '../gemini/contracts';
import { geminiTurnPort } from '../gemini/provider';
import { streamGoogleToolLoop } from '../gemini/google-tool-loop';
import type { GoogleToolName } from '../google/tools/contracts';
import { googleToolRegistry } from '../google/tools/registry';
import { formatMemoryContext, retrieveMemories } from '../memory/store';
import type { AutonomyPreferences } from '../domain/preferences';
import { evaluateAutonomyPermission } from './authority';
import { composeRoutineSystemInstruction } from './instruction';
import { parseRoutineOutcome } from './outcome';
import { evaluateEventAdmission, noveltyFingerprint } from './policy';
import {
  routineRunKey,
  type AutonomousEvent,
  type ElaraRoutine,
  type RoutineExecutionMode,
  type RoutineRunRecord,
} from './contracts';
import {
  addEvent,
  addRun,
  findRunInFlight,
  recentEvents,
  saveRoutine,
  updateRun,
} from '../persistence/autonomy';

// ---------------------------------------------------------------------------
// Routine run executor.
//
// Executes ONE routine run end-to-end: authority gate → in-flight guard →
// context → read-only agent loop → structured outcome gate → deterministic
// event policy → durable event + run record.
//
// Scheduler-agnostic BY CONSTRUCTION: this module never decides WHEN a run
// happens. `executionMode` records how it was triggered ('manual' today;
// 'scheduled'/'catch-up' arrive with the Phase B cloud scheduler behind the
// SchedulerPort). The engine is injectable so tests drive the loop without
// providers, exactly like the interactive tool-loop tests.
// ---------------------------------------------------------------------------

export interface RoutineEngineRequest {
  readonly model: string;
  readonly input: string;
  readonly systemInstruction: string;
  readonly tools: readonly GoogleToolName[];
  readonly maxToolCalls: number;
  readonly signal?: AbortSignal;
}

export type RoutineEngine = (request: RoutineEngineRequest) => AsyncGenerator<GeminiStreamEvent>;

/** Default engine: the canonical Google tool loop (read-only), or a plain provider turn when no tools are granted. */
export const routineEngine: RoutineEngine = (request) => {
  if (request.tools.length > 0) {
    const turnRequest: GeminiTurnRequest = {
      model: request.model,
      input: request.input,
      systemInstruction: request.systemInstruction,
      tools: request.tools,
      memoryContext: 'none',
    };
    return streamGoogleToolLoop(turnRequest, { tools: request.tools, readOnly: true, maxToolCalls: request.maxToolCalls, suppressRuntimeContext: true, allowEmptyTools: false }, request.signal);
  }
  return geminiTurnPort.streamReply({ model: request.model, input: request.input, systemInstruction: request.systemInstruction, memoryContext: 'none' }, request.signal);
};

export interface RoutineRunOptions {
  readonly model?: string;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  readonly engine?: RoutineEngine;
  readonly generateId?: () => string;
}

export interface RoutineRunResult {
  readonly run: RoutineRunRecord;
  readonly event: AutonomousEvent | null;
}

const MAX_ACCUMULATED_TEXT = 120_000;

function generateId(): string {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Map routine permissions to the read-only, Gemini-visible tool surface. */
export function routineToolSet(routine: ElaraRoutine): GoogleToolName[] {
  const granted = new Set<string>(routine.permissions.google);
  return googleToolRegistry
    .filter((descriptor) => descriptor.exposure === 'gemini' && descriptor.risk === 'read' && granted.has(descriptor.capability))
    .map((descriptor) => descriptor.name);
}

async function loadRoutineMemoryContext(routine: ElaraRoutine): Promise<string> {
  if (!routine.permissions.memory) return '';
  try {
    const query = `${routine.name}\n${routine.instruction}`.slice(0, 2_000);
    return formatMemoryContext(await retrieveMemories({ query, maxItems: 8, maxCharacters: 6_000 }));
  } catch {
    // A local memory problem must never block a routine run.
    return '';
  }
}

/**
 * Execute one routine run. Expected failures (authority denial, provider
 * failure, invalid outcome contract, suppression) are RETURNED as run records,
 * not thrown — the run history is the error surface.
 */
export async function executeRoutineRun(
  routine: ElaraRoutine,
  settings: AutonomyPreferences,
  executionMode: RoutineExecutionMode,
  options: RoutineRunOptions = {},
): Promise<RoutineRunResult> {
  const now = options.now ?? Date.now;
  const id = options.generateId ?? generateId;
  const engine = options.engine ?? routineEngine;

  const permission = evaluateAutonomyPermission(settings, routine);
  if (!permission.permitted) {
    const startedAt = now();
    const run: RoutineRunRecord = {
      id: id(),
      runKey: routineRunKey(routine.id, executionMode, startedAt),
      routineId: routine.id,
      routineName: routine.name,
      executionMode,
      scheduledFor: startedAt,
      startedAt,
      completedAt: startedAt,
      state: 'skipped',
      outcome: 'skipped',
      errorCode: permission.reason === 'master-disabled' ? 'AUTONOMY_DISABLED' : 'ROUTINE_DISABLED',
    };
    return { run: await addRun(run), event: null };
  }

  const inFlight = await findRunInFlight(routine.id);
  if (inFlight) {
    const startedAt = now();
    const run: RoutineRunRecord = {
      id: id(),
      runKey: routineRunKey(routine.id, executionMode, startedAt),
      routineId: routine.id,
      routineName: routine.name,
      executionMode,
      scheduledFor: startedAt,
      startedAt,
      completedAt: startedAt,
      state: 'skipped',
      outcome: 'skipped',
      errorCode: 'RUN_IN_FLIGHT',
    };
    return { run: await addRun(run), event: null };
  }

  const startedAt = now();
  const run: RoutineRunRecord = {
    id: id(),
    runKey: routineRunKey(routine.id, executionMode, startedAt),
    routineId: routine.id,
    routineName: routine.name,
    executionMode,
    scheduledFor: startedAt,
    startedAt,
    state: 'running',
  };
  await addRun(run);

  const memoryContext = await loadRoutineMemoryContext(routine);
  const systemInstruction = composeRoutineSystemInstruction(routine, memoryContext);
  const tools = routineToolSet(routine);

  let text = '';
  let toolCalls = 0;
  let interactionId: string | undefined;
  let sawTerminal = false;

  /** Stamp the routine's last-run summary. Best-effort: the run record is authoritative. */
  const stampRoutine = async (completedAt: number, state: RoutineRunRecord['state'], outcome: RoutineRunRecord['outcome'], eventId?: string): Promise<void> => {
    try {
      await saveRoutine({ ...routine, lastRunAt: completedAt, lastResult: { at: completedAt, state, ...(outcome ? { outcome } : {}), ...(eventId ? { eventId } : {}) } });
    } catch {
      // Persisting the last-run summary is best-effort; the run record itself is authoritative.
    }
  };

  const finish = async (patch: Partial<RoutineRunRecord>): Promise<RoutineRunResult> => {
    const completedAt = patch.completedAt ?? now();
    const completedRun: RoutineRunRecord = { ...run, ...patch, completedAt, toolCalls, durationMs: Math.max(0, completedAt - startedAt), ...(interactionId ? { interactionId } : {}) };
    const savedRun = await updateRun(completedRun);
    if (completedRun.state === 'completed' || completedRun.state === 'cancelled' || completedRun.state === 'failed') {
      await stampRoutine(completedAt, completedRun.state, completedRun.outcome, completedRun.eventId);
    }
    return { run: savedRun, event: null };
  };

  try {
    for await (const event of engine({ model: options.model ?? DEFAULT_GEMINI_MODEL, input: routineInstructionPrompt(routine), systemInstruction, tools, maxToolCalls: routine.policy.maxToolCalls, signal: options.signal })) {
      if (event.type === 'interaction-created') interactionId = event.interactionId;
      else if (event.type === 'tool-call') toolCalls += 1;
      else if (event.type === 'text-delta' && text.length < MAX_ACCUMULATED_TEXT) text += event.text;
      else if (event.type === 'failed') {
        sawTerminal = true;
        return finish({ state: 'failed', outcome: 'error', errorCode: event.error.code ?? 'PROVIDER_FAILED', errorMessage: event.error.message });
      } else if (event.type === 'cancelled') {
        sawTerminal = true;
        return finish({ state: 'cancelled' });
      } else if (event.type === 'completed') {
        sawTerminal = true;
      }
    }
  } catch (cause) {
    if (options.signal?.aborted) return finish({ state: 'cancelled' });
    return finish({ state: 'failed', outcome: 'error', errorCode: 'RUN_INTERNAL', errorMessage: cause instanceof Error ? cause.message : 'The routine run could not be completed.' });
  }

  if (!sawTerminal) {
    return finish({ state: 'failed', outcome: 'error', errorCode: 'NO_TERMINAL_EVENT', errorMessage: 'The model stream ended without completing.' });
  }

  const parsed = parseRoutineOutcome(text);
  if (!parsed.ok) {
    return finish({ state: 'failed', outcome: 'error', errorCode: `OUTCOME_${parsed.error}`, errorMessage: 'The routine result did not satisfy the structured outcome contract.' });
  }

  if (parsed.outcome.outcome === 'noop') {
    return finish({ state: 'completed', outcome: 'no-op', ...(parsed.outcome.reason ? { reason: parsed.outcome.reason } : {}), ...(parsed.outcome.itemsExamined !== undefined ? { itemsExamined: parsed.outcome.itemsExamined } : {}) });
  }

  // Event proposal → deterministic policy gate (code decides, not the model).
  const fingerprint = noveltyFingerprint(routine.id, parsed.outcome.title, parsed.outcome.summary);
  const admissionWindowStart = now() - (7 * 24 * 3_600_000 + 3_600_000);
  const recent = await recentEvents(admissionWindowStart);
  const admission = evaluateEventAdmission({
    routineId: routine.id,
    fingerprint,
    recentEvents: recent,
    policy: routine.policy,
    maxEventsPerDay: settings.maxEventsPerDay,
    now: now(),
  });

  if (!admission.admitted) {
    return finish({ state: 'completed', outcome: 'suppressed', suppressedReason: admission.reason, reason: admission.detail });
  }

  const event: AutonomousEvent = {
    id: id(),
    routineId: routine.id,
    runKey: run.runKey,
    title: parsed.outcome.title,
    summary: parsed.outcome.summary,
    importance: parsed.outcome.importance,
    confidence: parsed.outcome.confidence,
    evidence: parsed.outcome.evidence ?? [],
    noveltyFingerprint: fingerprint,
    createdAt: now(),
    readAt: null,
  };
  await addEvent(event);
  const completedAt = now();
  const completedRun = await updateRun({ ...run, state: 'completed', outcome: 'event', eventId: event.id, completedAt, toolCalls, durationMs: Math.max(0, completedAt - startedAt), ...(interactionId ? { interactionId } : {}) });
  await stampRoutine(completedAt, 'completed', 'event', event.id);
  return { run: completedRun, event };
}

function routineInstructionPrompt(routine: ElaraRoutine): string {
  return `Execute the routine "${routine.name}" now, as described in your instructions, and end with the JSON outcome object.`;
}
