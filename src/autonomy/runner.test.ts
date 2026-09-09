import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRoutineRun, routineToolSet, type RoutineEngine, type RoutineEngineRequest } from './runner';
import { addEvent, addRun, clearAutonomyStore, getRoutine, listEvents, listRuns } from '../persistence/autonomy';
import { noveltyFingerprint } from './policy';
import type { AutonomyPreferences } from '../domain/preferences';
import type { AutonomousEvent, ElaraRoutine, RoutineRunRecord } from './contracts';
import type { GeminiStreamEvent } from '../gemini/contracts';

// ---------------------------------------------------------------------------
// The run executor, driven end-to-end against the real local store with an
// injected engine — the same seam the provider tests use. The authority gate,
// in-flight guard, outcome contract, deterministic admission policy, and
// persistence are all exercised without any network or provider.

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const settings: AutonomyPreferences = { enabled: true, maxEventsPerDay: 10 };

function makeRoutine(overrides: Partial<ElaraRoutine> = {}): ElaraRoutine {
  return {
    id: 'r-1',
    name: 'Morning brief',
    enabled: true,
    instruction: 'Check my calendar and tell me about morning changes.',
    schedule: { kind: 'daily', time: '09:00', days: 'weekdays' },
    timezone: 'Africa/Johannesburg',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function engineFor(events: GeminiStreamEvent[], onCall?: (request: RoutineEngineRequest) => void): RoutineEngine {
  return async function* (request) {
    onCall?.(request);
    for (const event of events) yield event;
  };
}

function textRun(text: string, extras: GeminiStreamEvent[] = []): GeminiStreamEvent[] {
  return [
    { type: 'interaction-created', interactionId: 'it-1', model: 'test-model' },
    ...extras,
    { type: 'text-delta', index: 1, text },
    { type: 'completed', interactionId: 'it-1', status: 'done', durationMs: 12 },
  ];
}

const NOOP = '{"outcome":"noop","reason":"calendar unchanged","itemsExamined":3}';
const EVENT = JSON.stringify({
  outcome: 'event',
  title: 'Stand-up moved to 09:30',
  summary: 'Your stand-up moved later and now overlaps the design review.',
  importance: 2,
  confidence: 3,
  evidence: [{ kind: 'tool', ref: 'calendar.listEvents', note: 'today' }],
});

function runOptions(engine: RoutineEngine) {
  let counter = 0;
  return {
    engine,
    now: () => NOW,
    model: 'test-model',
    generateId: () => `id-${(counter += 1)}`,
  };
}

beforeEach(async () => {
  await clearAutonomyStore();
});

describe('executeRoutineRun — authority and overlap guards', () => {
  it('skips without calling the engine when the master switch is off', async () => {
    const onCall = vi.fn();
    const { run } = await executeRoutineRun(makeRoutine(), { ...settings, enabled: false }, 'manual', runOptions(engineFor([], onCall)));
    expect(run.state).toBe('skipped');
    expect(run.outcome).toBe('skipped');
    expect(run.errorCode).toBe('AUTONOMY_DISABLED');
    expect(onCall).not.toHaveBeenCalled();
    expect(await listEvents()).toEqual([]);
  });

  it('skips when the routine itself is disabled', async () => {
    const { run } = await executeRoutineRun(makeRoutine({ enabled: false }), settings, 'manual', runOptions(engineFor([])));
    expect(run.errorCode).toBe('ROUTINE_DISABLED');
  });

  it('skips when another run for the routine is already in flight', async () => {
    const inFlight: RoutineRunRecord = {
      id: 'prior', runKey: 'r-1:scheduled:1', routineId: 'r-1', routineName: 'Morning brief',
      executionMode: 'scheduled', scheduledFor: NOW - 1_000, startedAt: NOW - 1_000, state: 'running',
    };
    await addRun(inFlight);
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor([])));
    expect(run.errorCode).toBe('RUN_IN_FLIGHT');
  });
});

describe('executeRoutineRun — outcomes', () => {
  it('records a completed no-op run and persists run history', async () => {
    const toolCall: GeminiStreamEvent = { type: 'tool-call', interactionId: 'it-1', index: 2, callId: 'c1', name: 'calendar.listEvents', arguments: {} };
    const { run, event } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(NOOP, [toolCall]))));
    expect(run.state).toBe('completed');
    expect(run.outcome).toBe('no-op');
    expect(run.reason).toBe('calendar unchanged');
    expect(run.itemsExamined).toBe(3);
    expect(run.toolCalls).toBe(1);
    expect(run.interactionId).toBe('it-1');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(event).toBeNull();
    expect(await listEvents()).toEqual([]);

    const stored = await listRuns();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: run.id, state: 'completed', outcome: 'no-op' });

    const routine = await getRoutine('r-1');
    expect(routine?.lastResult).toMatchObject({ state: 'completed', outcome: 'no-op' });
  });

  it('delivers an admitted event to the inbox and stamps the routine', async () => {
    const { run, event } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(EVENT))));
    expect(run.state).toBe('completed');
    expect(run.outcome).toBe('event');
    expect(event).not.toBeNull();
    if (!event) throw new Error('unreachable');
    expect(event).toMatchObject({
      routineId: 'r-1',
      runKey: run.runKey,
      title: 'Stand-up moved to 09:30',
      importance: 2,
      confidence: 3,
      readAt: null,
    });
    expect(event.noveltyFingerprint).toBe(noveltyFingerprint('r-1', 'Stand-up moved to 09:30', 'Your stand-up moved later and now overlaps the design review.'));
    expect(event.evidence).toEqual([{ kind: 'tool', ref: 'calendar.listEvents', note: 'today' }]);

    const stored = await listEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(event.id);

    const routine = await getRoutine('r-1');
    expect(routine?.lastResult).toMatchObject({ state: 'completed', outcome: 'event', eventId: event.id });
    expect(routine?.lastRunAt).toBe(NOW);
  });

  it('suppresses a cooldown violation instead of delivering it', async () => {
    await addEvent({ ...makeSeedEvent('e-1'), createdAt: NOW - 2 * HOUR });
    const { run, event } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(EVENT))));
    expect(run.state).toBe('completed');
    expect(run.outcome).toBe('suppressed');
    expect(run.suppressedReason).toBe('cooldown');
    expect(event).toBeNull();
    expect(await listEvents()).toHaveLength(1);
  });

  it('suppresses duplicates of recently delivered content', async () => {
    // Seed an event whose fingerprint matches the proposal exactly, older than
    // the 1-hour cooldown so the duplicate rule is what fires.
    const fingerprint = noveltyFingerprint('r-1', 'Stand-up moved to 09:30', 'Your stand-up moved later and now overlaps the design review.');
    await addEvent({ ...makeSeedEvent('e-1'), noveltyFingerprint: fingerprint, createdAt: NOW - 3 * HOUR });
    const routine = makeRoutine({ policy: { cooldownHours: 1, maxToolCalls: 8, maxRunsPerDay: 4 } });
    const { run, event } = await executeRoutineRun(routine, settings, 'manual', runOptions(engineFor(textRun(EVENT))));
    expect(run.outcome).toBe('suppressed');
    expect(run.suppressedReason).toBe('duplicate');
    expect(event).toBeNull();
  });

  it('suppresses when the rolling daily event cap is reached', async () => {
    await addEvent({ ...makeSeedEvent('e-1'), routineId: 'r-9', createdAt: NOW - HOUR });
    const capped: AutonomyPreferences = { enabled: true, maxEventsPerDay: 1 };
    const { run, event } = await executeRoutineRun(makeRoutine(), capped, 'manual', runOptions(engineFor(textRun(EVENT))));
    expect(run.outcome).toBe('suppressed');
    expect(run.suppressedReason).toBe('daily-cap');
    expect(event).toBeNull();
  });
});

describe('executeRoutineRun — failure paths', () => {
  it('records a provider failure with the normalized error code', async () => {
    const failure: GeminiStreamEvent[] = [{ type: 'failed', error: { category: 'authentication', code: 'PROVIDER_AUTH', message: 'The Gemini key was rejected.', retryable: false, cancelled: false, debug: {} } }];
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(failure)));
    expect(run.state).toBe('failed');
    expect(run.outcome).toBe('error');
    expect(run.errorCode).toBe('PROVIDER_AUTH');
    expect(run.errorMessage).toContain('rejected');
  });

  it('fails a stream that ends without a terminal event', async () => {
    const dangling: GeminiStreamEvent[] = [{ type: 'text-delta', index: 1, text: 'half an answer' }];
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(dangling)));
    expect(run.state).toBe('failed');
    expect(run.errorCode).toBe('NO_TERMINAL_EVENT');
  });

  it('fails when the engine itself throws', async () => {
    const exploding: RoutineEngine = async function* () {
      yield { type: 'interaction-created', interactionId: 'it-1', model: 'test-model' };
      throw new Error('transport collapsed');
    };
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(exploding));
    expect(run.state).toBe('failed');
    expect(run.errorCode).toBe('RUN_INTERNAL');
    expect(run.errorMessage).toContain('transport collapsed');
  });

  it('fails outcome text that is not JSON — never invents a fallback action', async () => {
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun('All quiet on the calendar front.'))));
    expect(run.outcome).toBe('error');
    expect(run.errorCode).toBe('OUTCOME_NO_JSON');
  });

  it('fails outcome JSON that violates the contract', async () => {
    const bad = '{"outcome":"event","title":"t","summary":"s","importance":5,"confidence":2}';
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(bad))));
    expect(run.errorCode).toBe('OUTCOME_INVALID_CONTRACT');
  });
});

describe('routineToolSet', () => {
  it('maps granted read capabilities to the Gemini-visible read-only tool surface', () => {
    const routine = makeRoutine({ permissions: { memory: false, google: ['calendar.events.read', 'tasks.read', 'gmail.read', 'chat.read', 'docs.read', 'sheets.read', 'drive.library.read'] } });
    const tools = routineToolSet(routine);
    expect(tools).toContain('calendar.listEvents');
    expect(tools).toEqual(expect.arrayContaining(['tasks.listTasks', 'gmail.listMessages', 'docs.inspectDocument', 'sheets.readRange', 'drive.searchLibrary']));
    // chat.read tools are deferred (internal exposure) and must not be routable.
    expect(tools.some((tool) => tool.startsWith('chat.'))).toBe(false);
    // No write or destructive tool can ever appear.
    expect(tools.some((tool) => tool.includes('create') || tool.includes('delete') || tool.includes('write'))).toBe(false);
  });

  it('yields an empty tool surface when no Google permissions are granted', () => {
    expect(routineToolSet(makeRoutine())).toEqual([]);
  });
});

describe('executeRoutineRun — engine request composition', () => {
  it('passes the composed instruction, granted tools, and tool budget', async () => {
    let seen: RoutineEngineRequest | undefined;
    const routine = makeRoutine({ permissions: { memory: false, google: ['tasks.read'] } });
    await executeRoutineRun(routine, settings, 'manual', runOptions(engineFor(textRun(NOOP), (request) => { seen = request; })));
    expect(seen).toBeDefined();
    expect(seen?.tools).toEqual(expect.arrayContaining(['tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask']));
    expect(seen?.maxToolCalls).toBe(8);
    expect(seen?.systemInstruction).toContain('Morning brief');
    expect(seen?.systemInstruction).toContain('untrusted EVIDENCE');
    expect(seen?.systemInstruction).toContain('{"outcome":"noop"');
    expect(seen?.input).toContain('Morning brief');
  });

  it('does not leak the interactive runtime-context decorator or chat memory scoping', async () => {
    let seen: RoutineEngineRequest | undefined;
    await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(NOOP), (request) => { seen = request; })));
    // The routine instruction owns runtime context ("Runtime context:"), while
    // the chat decorator would prepend roleplay guidance.
    expect(seen?.systemInstruction).toContain('Runtime context:');
    expect(seen?.systemInstruction.startsWith('Runtime context')).toBe(false);
  });
});

function makeSeedEvent(id: string): AutonomousEvent {
  return {
    id,
    routineId: 'r-1',
    runKey: 'r-1:scheduled:0',
    title: 'Unrelated earlier event',
    summary: 'Something else entirely.',
    importance: 1,
    confidence: 2,
    evidence: [],
    noveltyFingerprint: noveltyFingerprint('r-1', 'Unrelated earlier event', 'Something else entirely.'),
    createdAt: NOW - 2 * HOUR,
    readAt: null,
  };
}
