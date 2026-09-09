import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRoutineRun, routineToolSet, type RoutineEngine, type RoutineEngineRequest } from './runner';
import { addEvent, addRun, clearAutonomyStore, deleteRoutine, getRoutine, listEvents, listRuns, saveRoutine } from '../persistence/autonomy';
import { noveltyFingerprint } from './policy';
import { normalizeRoutine } from './contracts';
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

let idCounter = 0;

function runOptions(engine: RoutineEngine, now: () => number = () => NOW) {
  return {
    engine,
    now,
    model: 'test-model',
    generateId: () => `id-${(idCounter += 1)}`,
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
    await saveRoutine(makeRoutine());
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
    await saveRoutine(makeRoutine());
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

  it('cannot acquire write, destructive, internal, or local-artifact tools from tampered persisted permissions', () => {
    // Tamper the persisted record directly: write-class capabilities, an unknown
    // capability, and the local-document capability (whose PDF tool is risk 'read'
    // and Gemini-exposed, so only the capability enum stands between it and routines).
    const tampered = normalizeRoutine({
      ...makeRoutine(),
      permissions: { memory: false, google: ['tasks.read', 'tasks.write', 'tasks.delete' as never, 'docs.write', 'documents.local' as never, 'nonexistent.read' as never] },
    });
    // The capability enum itself is the boundary: everything outside the
    // read-only routine set is dropped during normalization, before any
    // registry lookup can happen.
    expect(tampered.permissions.google).toEqual(['tasks.read']);
    const tools = routineToolSet(tampered);
    expect(tools).toEqual(expect.arrayContaining(['tasks.listTasks']));
    expect(tools.some((tool) => /create|delete|write|update|move|insert|replace|append|clear|modify/i.test(tool))).toBe(false);
    expect(tools).not.toContain('document.create_pdf');
    expect(tools).not.toContain('docs.inspectDocument');
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

// ---------------------------------------------------------------------------
// Hardening regressions: concurrent admission, occurrence identity, terminal
// stamping, mid-run mutation, memory boundary, stale-run recovery.
// ---------------------------------------------------------------------------

/** An engine that parks after its first event until released — lets tests
 * hold a run in flight while a second execution or a user edit happens. */
function pausableEngine(): { engine: RoutineEngine; started: Promise<void>; release: () => void } {
  let releaseGate!: () => void;
  let startedResolve!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const engine: RoutineEngine = async function* () {
    startedResolve();
    yield { type: 'interaction-created', interactionId: 'it-gated', model: 'test-model' };
    await gate;
    yield { type: 'text-delta', index: 1, text: NOOP };
    yield { type: 'completed', interactionId: 'it-gated', status: 'done', durationMs: 5 };
  };
  return { engine, started, release: releaseGate };
}

describe('executeRoutineRun — concurrent Run Now admission', () => {
  it('admits at most one of two overlapping runs and refuses the other with RUN_IN_FLIGHT', async () => {
    const { engine, started, release } = pausableEngine();
    let clock = NOW;
    const first = executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engine, () => clock));
    await started; // the first run has claimed and entered its engine
    clock += 1; // a later trigger must have its own identity (same-ms is the already-executed case)
    const second = executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engine, () => clock));
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const outcomes = [firstResult.run, secondResult.run].sort((a, b) => (a.state === 'skipped' ? 1 : 0) - (b.state === 'skipped' ? 1 : 0));
    expect(outcomes[0]).toMatchObject({ state: 'completed', outcome: 'no-op' });
    expect(outcomes[1]).toMatchObject({ state: 'skipped', outcome: 'skipped', errorCode: 'RUN_IN_FLIGHT' });

    const stored = await listRuns();
    expect(stored.filter((run) => run.state === 'completed')).toHaveLength(1);
    expect(stored.filter((run) => run.state === 'running')).toHaveLength(0);
    expect(await listEvents()).toEqual([]);
  });

  it('recovers from a crashed run: a stale in-flight record is abandoned, not obeyed forever', async () => {
    const staleStartedAt = NOW - 16 * 60_000;
    await addRun({
      id: 'crashed', runKey: 'r-1:manual:old', routineId: 'r-1', routineName: 'Morning brief',
      executionMode: 'manual', scheduledFor: staleStartedAt, startedAt: staleStartedAt, state: 'running',
    });
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(NOOP))));
    expect(run.state).toBe('completed');
    const crashed = (await listRuns()).find((record) => record.id === 'crashed');
    expect(crashed).toMatchObject({ state: 'failed', outcome: 'error', errorCode: 'RUN_ABANDONED' });
  });
});

describe('executeRoutineRun — occurrence identity (scheduled / catch-up)', () => {
  it('derives run identity from the occurrence, not the start time', async () => {
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'scheduled', { ...runOptions(engineFor(textRun(NOOP))), scheduledFor: 5_000 });
    expect(run.runKey).toBe('r-1:scheduled:5000');
    expect(run.scheduledFor).toBe(5_000);
    expect(run.startedAt).toBe(NOW);
  });

  it('redelivery of the same scheduled occurrence executes once and returns the existing record', async () => {
    const first = await executeRoutineRun(makeRoutine(), settings, 'scheduled', { ...runOptions(engineFor(textRun(EVENT))), scheduledFor: 5_000 });
    const second = await executeRoutineRun(makeRoutine(), settings, 'scheduled', { ...runOptions(engineFor(textRun(EVENT))), scheduledFor: 5_000 });
    expect(second.run.id).toBe(first.run.id);
    expect(await listRuns()).toHaveLength(1);
    expect(await listEvents()).toHaveLength(1);
  });

  it('a different occurrence is a different execution', async () => {
    await executeRoutineRun(makeRoutine(), settings, 'scheduled', { ...runOptions(engineFor(textRun(NOOP))), scheduledFor: 5_000 });
    const later = await executeRoutineRun(makeRoutine(), settings, 'scheduled', { ...runOptions(engineFor(textRun(NOOP))), scheduledFor: 6_000 });
    expect(later.run.runKey).toBe('r-1:scheduled:6000');
    expect(await listRuns()).toHaveLength(2);
  });

  it('catch-up retains the source occurrence identity, and a repeated catch-up dedupes', async () => {
    const first = await executeRoutineRun(makeRoutine(), settings, 'catch-up', { ...runOptions(engineFor(textRun(NOOP))), scheduledFor: 5_000 });
    expect(first.run.runKey).toBe('r-1:catch-up:5000');
    expect(first.run.scheduledFor).toBe(5_000);
    const repeat = await executeRoutineRun(makeRoutine(), settings, 'catch-up', { ...runOptions(engineFor(textRun(NOOP))), scheduledFor: 5_000 });
    expect(repeat.run.id).toBe(first.run.id);
    expect(await listRuns()).toHaveLength(1);
  });
});

describe('executeRoutineRun — lastResult stamping across every terminal path', () => {
  type TerminalCase = { name: string; events: () => GeminiStreamEvent[]; state: RoutineRunRecord['state']; outcome?: RoutineRunRecord['outcome']; seed?: () => Promise<void> };

  const cases: TerminalCase[] = [
    { name: 'completed no-op', events: () => textRun(NOOP), state: 'completed', outcome: 'no-op' },
    { name: 'completed admitted event', events: () => textRun(EVENT), state: 'completed', outcome: 'event' },
    { name: 'completed suppressed (cooldown)', events: () => textRun(EVENT), state: 'completed', outcome: 'suppressed', seed: async () => { await addEvent({ ...makeSeedEvent('e-1'), createdAt: NOW - 2 * HOUR }); } },
    { name: 'failed provider error', events: () => [{ type: 'failed', error: { category: 'network', code: 'PROVIDER_NETWORK', message: 'The request failed.', retryable: true, cancelled: false, debug: {} } }], state: 'failed', outcome: 'error' },
    { name: 'failed malformed outcome', events: () => textRun('definitely not JSON'), state: 'failed', outcome: 'error' },
    { name: 'failed no terminal event', events: () => [{ type: 'text-delta', index: 1, text: 'half an answer' }], state: 'failed', outcome: 'error' },
    { name: 'failed engine exception', events: () => textRun(NOOP), state: 'failed', outcome: 'error' }, // replaced inline below
    { name: 'cancelled by provider', events: () => [{ type: 'cancelled', interactionId: 'it-1' }], state: 'cancelled' },
  ];

  it.each(cases.filter((testCase) => testCase.name !== 'failed engine exception'))('stamps lastResult for: $name', async ({ events, state, outcome, seed }) => {
    await saveRoutine(makeRoutine());
    await seed?.();
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(events())));
    expect(run.state).toBe(state);
    if (outcome) expect(run.outcome).toBe(outcome);
    expect(run.completedAt).toBeDefined();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    const routine = await getRoutine('r-1');
    expect(routine?.lastRunAt).toBe(run.completedAt);
    expect(routine?.lastResult).toMatchObject({ at: run.completedAt, state, ...(outcome ? { outcome } : {}) });
  });

  it('stamps lastResult for: failed engine exception', async () => {
    await saveRoutine(makeRoutine());
    const exploding: RoutineEngine = async function* () { throw new Error('transport collapsed'); };
    const { run } = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(exploding));
    expect(run).toMatchObject({ state: 'failed', outcome: 'error', errorCode: 'RUN_INTERNAL' });
    const routine = await getRoutine('r-1');
    expect(routine?.lastResult).toMatchObject({ state: 'failed', outcome: 'error' });
  });

  it('does NOT stamp lastResult for skipped runs — the previous real run stays the "last run"', async () => {
    await saveRoutine(makeRoutine());
    const completed = await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(NOOP))));
    const before = (await getRoutine('r-1'))?.lastResult;

    await executeRoutineRun(makeRoutine(), { ...settings, enabled: false }, 'manual', runOptions(engineFor([])));
    await executeRoutineRun(makeRoutine({ enabled: false }), settings, 'manual', runOptions(engineFor([])));

    const routine = await getRoutine('r-1');
    expect(routine?.lastResult).toEqual(before);
    expect(routine?.lastRunAt).toBe(completed.run.completedAt);
  });
});

describe('executeRoutineRun — routine mutated or deleted mid-run', () => {
  it('a user edit made while the run executes is never clobbered by the run\'s stale routine copy', async () => {
    const { engine, started, release } = pausableEngine();
    const promise = executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engine));
    await started;
    await saveRoutine(makeRoutine({ name: 'Renamed mid-run', instruction: 'Updated instruction.' }));
    release();
    const { run } = await promise;
    expect(run.state).toBe('completed');
    const routine = await getRoutine('r-1');
    expect(routine?.name).toBe('Renamed mid-run');
    expect(routine?.instruction).toBe('Updated instruction.');
    expect(routine?.lastResult).toMatchObject({ state: 'completed', outcome: 'no-op' });
  });

  it('a routine deleted mid-run completes its record without resurrecting the routine', async () => {
    const { engine, started, release } = pausableEngine();
    const promise = executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engine));
    await started;
    await deleteRoutine('r-1');
    release();
    const { run } = await promise;
    expect(run.state).toBe('completed');
    expect(await getRoutine('r-1')).toBeUndefined();
    expect((await listRuns()).map((record) => record.routineName)).toEqual(['Morning brief']);
  });
});

describe('executeRoutineRun — memory context boundary', () => {
  it('honors an explicit bounded context payload only when the memory permission is granted', async () => {
    let clock = NOW;
    let seen: RoutineEngineRequest | undefined;
    const granted = makeRoutine({ permissions: { memory: true, google: [] } });
    await executeRoutineRun(granted, settings, 'manual', { ...runOptions(engineFor(textRun(NOOP), (request) => { seen = request; }), () => clock), memoryContext: 'PACK: user prefers morning meetings' });
    expect(seen?.systemInstruction).toContain('PACK: user prefers morning meetings');

    clock += 1;
    let seenDenied: RoutineEngineRequest | undefined;
    const denied = makeRoutine({ permissions: { memory: false, google: [] } });
    await executeRoutineRun(denied, settings, 'manual', { ...runOptions(engineFor(textRun(NOOP), (request) => { seenDenied = request; }), () => clock), memoryContext: 'PACK: must never appear' });
    expect(seenDenied?.systemInstruction).not.toContain('PACK: must never appear');
    expect(seenDenied?.systemInstruction).not.toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
  });

  it('local Run Now (no payload) composes context from the local store only when permitted', async () => {
    let clock = NOW;
    let seenGranted: RoutineEngineRequest | undefined;
    await executeRoutineRun(makeRoutine({ permissions: { memory: true, google: [] } }), settings, 'manual', runOptions(engineFor(textRun(NOOP), (request) => { seenGranted = request; }), () => clock));
    // The local memory store is empty in tests: no context section is added, and the run still succeeds.
    expect(seenGranted?.systemInstruction).toContain('{"outcome":"noop"');

    clock += 1;
    let seenPlain: RoutineEngineRequest | undefined;
    await executeRoutineRun(makeRoutine(), settings, 'manual', runOptions(engineFor(textRun(NOOP), (request) => { seenPlain = request; }), () => clock));
    expect(seenPlain?.systemInstruction).not.toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
  });
});
