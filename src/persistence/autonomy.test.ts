import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTONOMY_UPDATED_EVENT,
  RoutineLimitError,
  STALE_RUN_MS,
  addEvent,
  addRun,
  autonomyDb,
  claimRoutineRun,
  clearAutonomyStore,
  countUnreadEvents,
  deleteRoutine,
  findRunInFlight,
  getRoutine,
  getRunByRunKey,
  listEvents,
  listRoutines,
  listRuns,
  listRunsForRoutine,
  markAllEventsRead,
  markEventRead,
  recentEvents,
  saveRoutine,
} from './autonomy';
import { MAX_ROUTINES } from '../autonomy/contracts';
import { noveltyFingerprint } from '../autonomy/policy';
import type { AutonomousEvent, ElaraRoutine, RoutineRunRecord } from '../autonomy/contracts';

const NOW = 1_700_000_000_000;

function makeRoutine(id: string, overrides: Partial<ElaraRoutine> = {}): ElaraRoutine {
  return {
    id,
    name: `Routine ${id}`,
    enabled: true,
    instruction: 'Do the thing.',
    schedule: { kind: 'daily', time: '09:00', days: 'every' },
    timezone: 'UTC',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRun(id: string, overrides: Partial<RoutineRunRecord> = {}): RoutineRunRecord {
  return {
    id,
    runKey: `r-1:manual:${NOW}`,
    routineId: 'r-1',
    routineName: 'Routine r-1',
    executionMode: 'manual',
    scheduledFor: NOW,
    startedAt: NOW,
    state: 'completed',
    outcome: 'no-op',
    ...(overrides.state === 'running' || overrides.state === 'pending' ? {} : { completedAt: NOW }),
    ...overrides,
  };
}

function makeEvent(id: string, overrides: Partial<AutonomousEvent> = {}): AutonomousEvent {
  return {
    id,
    routineId: 'r-1',
    runKey: `r-1:manual:${NOW}`,
    title: `Event ${id}`,
    summary: 'Something worth surfacing.',
    importance: 2,
    confidence: 3,
    evidence: [],
    noveltyFingerprint: noveltyFingerprint('r-1', `Event ${id}`, 'Something worth surfacing.'),
    createdAt: NOW,
    readAt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearAutonomyStore();
});

describe('routine persistence', () => {
  it('saves, lists (newest first), fetches, and deletes routines', async () => {
    await saveRoutine(makeRoutine('r-1', { updatedAt: NOW }));
    await saveRoutine(makeRoutine('r-2', { updatedAt: NOW + 1_000 }));
    expect((await listRoutines()).map((routine) => routine.id)).toEqual(['r-2', 'r-1']);
    expect((await getRoutine('r-1'))?.name).toBe('Routine r-1');
    await deleteRoutine('r-1');
    expect(await getRoutine('r-1')).toBeUndefined();
    expect((await listRoutines()).map((routine) => routine.id)).toEqual(['r-2']);
  });

  it('enforces the routine limit for new routines but not updates', async () => {
    for (let index = 0; index < MAX_ROUTINES; index += 1) await saveRoutine(makeRoutine(`r-${index}`));
    await expect(saveRoutine(makeRoutine('r-extra'))).rejects.toBeInstanceOf(RoutineLimitError);
    await expect(saveRoutine(makeRoutine('r-0', { name: 'Updated' }))).resolves.toMatchObject({ id: 'r-0', name: 'Updated' });
  });

  it('announces writes so UI components can refresh', async () => {
    const listener = vi.fn();
    window.addEventListener(AUTONOMY_UPDATED_EVENT, listener);
    await saveRoutine(makeRoutine('r-1'));
    expect(listener).toHaveBeenCalled();
    window.removeEventListener(AUTONOMY_UPDATED_EVENT, listener);
  });
});

describe('event persistence', () => {
  it('lists events newest first and counts unread', async () => {
    await addEvent(makeEvent('e-1', { createdAt: NOW }));
    await addEvent(makeEvent('e-2', { createdAt: NOW + 1_000 }));
    expect((await listEvents()).map((event) => event.id)).toEqual(['e-2', 'e-1']);
    expect(await countUnreadEvents()).toBe(2);
  });

  it('marks one event read exactly once, and all events read in bulk', async () => {
    await addEvent(makeEvent('e-1'));
    await addEvent(makeEvent('e-2'));
    await markEventRead('e-1', NOW + 5);
    await markEventRead('e-1', NOW + 9);
    expect((await listEvents()).find((event) => event.id === 'e-1')?.readAt).toBe(NOW + 5);
    await markAllEventsRead(NOW + 10);
    expect(await countUnreadEvents()).toBe(0);
  });

  it('loads only recent events for admission windows', async () => {
    await addEvent(makeEvent('e-old', { createdAt: NOW - 8 * 24 * 3_600_000 }));
    await addEvent(makeEvent('e-new', { createdAt: NOW }));
    expect((await recentEvents(NOW - 7 * 24 * 3_600_000)).map((event) => event.id)).toEqual(['e-new']);
  });

  it('prunes events older than the 90-day retention window on write', async () => {
    await addEvent(makeEvent('e-stale', { createdAt: NOW - 91 * 24 * 3_600_000 }));
    await addEvent(makeEvent('e-fresh', { createdAt: NOW }));
    const ids = (await listEvents()).map((event) => event.id);
    expect(ids).toContain('e-fresh');
    expect(ids).not.toContain('e-stale');
  });
});

describe('run persistence', () => {
  it('lists runs newest first, per routine, and by run key', async () => {
    await addRun(makeRun('run-1', { startedAt: NOW, completedAt: NOW }));
    await addRun(makeRun('run-2', { runKey: 'r-1:manual:2', startedAt: NOW + 1_000, completedAt: NOW + 1_000 }));
    await addRun(makeRun('run-3', { routineId: 'r-2', runKey: 'r-2:manual:3', routineName: 'Other', startedAt: NOW + 2_000, completedAt: NOW + 2_000 }));
    expect((await listRuns()).map((run) => run.id)).toEqual(['run-3', 'run-2', 'run-1']);
    expect((await listRunsForRoutine('r-1')).map((run) => run.id)).toEqual(['run-2', 'run-1']);
    expect((await getRunByRunKey('r-2:manual:3'))?.id).toBe('run-3');
  });

  it('finds only in-flight runs for the overlap guard', async () => {
    await addRun(makeRun('run-done', { state: 'completed', outcome: 'no-op', completedAt: NOW }));
    expect(await findRunInFlight('r-1')).toBeUndefined();
    await addRun(makeRun('run-live', { id: 'run-live', runKey: 'r-1:scheduled:9', state: 'running' }));
    expect((await findRunInFlight('r-1'))?.id).toBe('run-live');
  });
});

describe('claimRoutineRun — atomic run admission', () => {
  it('admits one of two genuinely concurrent claims for the same routine (the check-then-insert race)', async () => {
    const claimA = claimRoutineRun(makeRun('run-a', { runKey: 'r-1:manual:1', state: 'running' }), NOW);
    const claimB = claimRoutineRun(makeRun('run-b', { runKey: 'r-1:manual:2', state: 'running' }), NOW);
    const [a, b] = await Promise.all([claimA, claimB]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['claimed', 'in-flight']);
    const allRuns = await listRuns();
    expect(allRuns.filter((run) => run.state === 'running')).toHaveLength(1);
  });

  it('returns already-executed for a duplicate runKey (idempotent occurrence redelivery)', async () => {
    const first = await claimRoutineRun(makeRun('run-1', { runKey: 'r-1:scheduled:500', state: 'running' }), NOW);
    expect(first.status).toBe('claimed');
    const duplicate = await claimRoutineRun(makeRun('run-2', { runKey: 'r-1:scheduled:500', state: 'running' }), NOW);
    expect(duplicate).toMatchObject({ status: 'already-executed', run: { id: 'run-1' } });
    expect(await listRuns()).toHaveLength(1);
  });

  it('admits a new run after the previous one completed, and refuses while one is in flight', async () => {
    await claimRoutineRun(makeRun('run-1', { runKey: 'r-1:manual:1', state: 'running' }), NOW);
    const during = await claimRoutineRun(makeRun('run-2', { runKey: 'r-1:manual:2', state: 'running' }), NOW);
    expect(during.status).toBe('in-flight');

    await addRun(makeRun('run-1', { state: 'completed', outcome: 'no-op', completedAt: NOW }));
    const after = await claimRoutineRun(makeRun('run-3', { runKey: 'r-1:manual:3', state: 'running' }), NOW);
    expect(after.status).toBe('claimed');
  });

  it('abandons a stale in-flight run (crashed process) instead of blocking the routine forever', async () => {
    const staleStartedAt = NOW - STALE_RUN_MS - 60_000;
    await addRun(makeRun('run-crashed', { runKey: 'r-1:manual:1', state: 'running', startedAt: staleStartedAt }));
    const claim = await claimRoutineRun(makeRun('run-2', { runKey: 'r-1:manual:2', state: 'running' }), NOW);
    expect(claim.status).toBe('claimed');

    const abandoned = await getRunByRunKey('r-1:manual:1');
    expect(abandoned).toMatchObject({ state: 'failed', outcome: 'error', errorCode: 'RUN_ABANDONED' });
    expect(abandoned?.completedAt).toBe(NOW);
  });

  it('does not treat a fresh in-flight run as stale', async () => {
    await addRun(makeRun('run-live', { runKey: 'r-1:manual:1', state: 'running', startedAt: NOW - 60_000 }));
    const claim = await claimRoutineRun(makeRun('run-2', { runKey: 'r-1:manual:2', state: 'running' }), NOW);
    expect(claim).toMatchObject({ status: 'in-flight', run: { id: 'run-live' } });
    expect((await getRunByRunKey('r-1:manual:1'))?.state).toBe('running');
  });

  it('is not broken by malformed persisted run records', async () => {
    // Corrupted rows must still carry the primary key to be addressable; realistic tampering keeps `id`.
    await autonomyDb.runs.put({ id: 'garbage-1', garbage: true } as never);
    await autonomyDb.runs.put({ id: 'half-baked', routineId: 'r-1' } as never);
    const claim = await claimRoutineRun(makeRun('run-1', { runKey: 'r-1:manual:1', state: 'running' }), NOW);
    expect(claim.status).toBe('claimed');
    // Malformed rows survive untouched and are inert: they never surface in
    // the ordered history (no startedAt → outside the index) and never block admission.
    expect(await autonomyDb.runs.count()).toBe(3);
    expect(await listRuns()).toHaveLength(1);
  });

  it('keeps run and event history when the originating routine is deleted', async () => {
    await saveRoutine(makeRoutine('r-1'));
    await addRun(makeRun('run-1', { state: 'completed', outcome: 'event', completedAt: NOW }));
    await addEvent(makeEvent('e-1'));
    await deleteRoutine('r-1');
    expect(await getRoutine('r-1')).toBeUndefined();
    expect((await listRuns()).map((run) => run.routineName)).toEqual(['Routine r-1']);
    expect((await listEvents()).map((event) => event.routineId)).toEqual(['r-1']);
  });

  it('prunes the oldest runs beyond the retention count and never the newest', async () => {
    const total = 1_005;
    const records: RoutineRunRecord[] = [];
    for (let index = 0; index < total; index += 1) {
      records.push(makeRun(`run-${index}`, { runKey: `r-9:manual:${index}`, routineId: 'r-9', routineName: 'Bulk', startedAt: NOW - (total - index) * 1_000, completedAt: NOW - (total - index) * 1_000, state: 'completed', outcome: 'no-op' }));
    }
    await autonomyDb.runs.bulkPut(records);
    await addRun(makeRun('run-trigger', { runKey: 'r-9:manual:newest', routineId: 'r-9', routineName: 'Bulk', startedAt: NOW, completedAt: NOW, state: 'completed', outcome: 'no-op' }));
    const surviving = await listRuns(2_000);
    expect(surviving).toHaveLength(1_000);
    expect(surviving[0]?.id).toBe('run-trigger');
    // 1005 bulk + 1 trigger = 1006 records; the 1000 newest survive → run-0…run-5 are pruned.
    expect(surviving.at(-1)?.id).toBe('run-6');
  });
});
