import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTONOMY_UPDATED_EVENT,
  RoutineLimitError,
  addEvent,
  addRun,
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
