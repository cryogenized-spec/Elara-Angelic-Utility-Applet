import { describe, expect, it } from 'vitest';
import {
  SCHEDULER_DEVICE_DUE_CODE,
  SCHEDULER_DRY_RUN_CODE,
  SCHEDULER_MISSED_CODE,
  SCHEDULER_OVERLAP_CODE,
  abandonedRunKey,
  buildSchedulerObservation,
  classifyDueOccurrence,
  decideRunClaim,
  nextAlarmTime,
  occurrenceGraceUntil,
  planScheduleReconciliation,
  schedulerBudgetUsed,
  type ClaimRunRecord,
  type SchedulerEntry,
} from './scheduler';
import type { ElaraRoutine, RoutineRunRecord } from './contracts';

const NOW = 1_700_000_000_000;

function makeRoutine(overrides: Partial<ElaraRoutine> = {}): ElaraRoutine {
  return {
    id: 'r-1',
    name: 'Morning brief',
    enabled: true,
    instruction: 'Tell me about my morning.',
    schedule: { kind: 'daily', time: '09:00', days: 'every' },
    timezone: 'UTC',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ClaimRunRecord> = {}): ClaimRunRecord {
  return { id: 'run-1', runKey: 'r-1:scheduled:500', routineId: 'r-1', state: 'completed', startedAt: NOW, ...overrides };
}

describe('occurrence grace windows (design §7.3)', () => {
  it('interval grace = min(half the interval, 6 h)', () => {
    const halfHour = occurrenceGraceUntil({ kind: 'interval', everyMinutes: 30 }, 'UTC', 1_000);
    expect(halfHour - 1_000).toBe(15 * 60_000);
    const twelveHour = occurrenceGraceUntil({ kind: 'interval', everyMinutes: 720 }, 'UTC', 1_000);
    expect(twelveHour - 1_000).toBe(6 * 3_600_000);
    const day = occurrenceGraceUntil({ kind: 'interval', everyMinutes: 1_440 }, 'UTC', 1_000);
    expect(day - 1_000).toBe(6 * 3_600_000); // capped, never 12 h
  });

  it('daily grace runs until the next scheduled occurrence', () => {
    // Weekdays-only 09:00 UTC: a Monday 09:00 occurrence stays catch-up-eligible until Tuesday 09:00.
    const monday = Date.UTC(2026, 8, 7, 9, 0); // Monday
    const grace = occurrenceGraceUntil({ kind: 'daily', time: '09:00', days: 'weekdays' }, 'UTC', monday);
    expect(grace).toBe(Date.UTC(2026, 8, 8, 9, 0)); // Tuesday
  });
});

describe('classifyDueOccurrence', () => {
  const interval = { kind: 'interval', everyMinutes: 60 } as const;

  it('an occurrence processed within the on-time tolerance is scheduled', () => {
    expect(classifyDueOccurrence(interval, 'UTC', NOW, NOW + 4 * 60_000)).toEqual({ mode: 'scheduled' });
  });

  it('a late-but-within-grace occurrence is catch-up', () => {
    expect(classifyDueOccurrence(interval, 'UTC', NOW, NOW + 20 * 60_000)).toEqual({ mode: 'catch-up' });
  });

  it('an occurrence beyond grace is missed — never repaired into a late run', () => {
    expect(classifyDueOccurrence(interval, 'UTC', NOW, NOW + 31 * 60_000)).toEqual({ mode: 'missed' });
  });
});

describe('decideRunClaim — at-least-once wake correctness', () => {
  it('no existing runs → claim', () => {
    expect(decideRunClaim([], 'r-1:scheduled:500', 'r-1', NOW)).toEqual({ action: 'claim', abandoned: null });
  });

  it('terminal duplicate runKey → idempotent already-executed', () => {
    const existing = makeRun({ runKey: 'r-1:scheduled:500', state: 'completed' });
    expect(decideRunClaim([existing], 'r-1:scheduled:500', 'r-1', NOW)).toEqual({ action: 'already-executed', run: existing });
  });

  it('fresh in-flight duplicate (same occurrence, alarm retry) → refuse overlap', () => {
    const existing = makeRun({ runKey: 'r-1:scheduled:500', state: 'running', startedAt: NOW - 60_000 });
    expect(decideRunClaim([existing], 'r-1:scheduled:500', 'r-1', NOW)).toEqual({ action: 'in-flight', run: existing });
  });

  it('a different occurrence while a fresh run is in flight → refuse overlap', () => {
    const existing = makeRun({ runKey: 'r-1:scheduled:400', state: 'running', startedAt: NOW - 60_000 });
    expect(decideRunClaim([existing], 'r-1:scheduled:500', 'r-1', NOW)).toEqual({ action: 'in-flight', run: existing });
  });

  it('a STALE in-flight duplicate is abandoned and the occurrence reclaimed', () => {
    const crashed = makeRun({ id: 'crashed', runKey: 'r-1:scheduled:500', state: 'running', startedAt: NOW - 16 * 60_000 });
    const staleMs = 15 * 60_000;
    expect(decideRunClaim([crashed], 'r-1:scheduled:500', 'r-1', NOW, staleMs)).toEqual({ action: 'claim', abandoned: crashed });
    expect(abandonedRunKey(crashed)).toBe('r-1:scheduled:500#abandoned-crashed');
  });

  it('a stale in-flight run for another occurrence is abandoned so it cannot block the routine', () => {
    const crashed = makeRun({ id: 'crashed', runKey: 'r-1:scheduled:100', state: 'pending', startedAt: NOW - 20 * 60_000 });
    expect(decideRunClaim([crashed], 'r-1:scheduled:500', 'r-1', NOW, 15 * 60_000)).toEqual({ action: 'claim', abandoned: crashed });
  });

  it('cloud default stale window never abandons on wall-clock alone', () => {
    const running = makeRun({ state: 'running', startedAt: NOW - 24 * 3_600_000 });
    expect(decideRunClaim([running], 'r-1:scheduled:500', 'r-1', NOW)).toEqual({ action: 'in-flight', run: running });
  });
});

describe('planScheduleReconciliation — deterministic, idempotent registration', () => {
  it('an enabled routine registers its next occurrence (interval anchored at creation)', () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    const plan = planScheduleReconciliation([routine], [], NOW, true);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]!.routineId).toBe('r-1');
    // Anchor = createdAt: first grid tick strictly after NOW.
    const anchor = routine.createdAt;
    const step = 30 * 60_000;
    const expected = anchor + (Math.floor((NOW - anchor) / step) + 1) * step;
    expect(plan.upserts[0]!.dueAt).toBe(expected);
  });

  it('repeated delivery with unchanged state produces an empty plan (idempotent)', () => {
    const routine = makeRoutine();
    const first = planScheduleReconciliation([routine], [], NOW, true);
    const applied: SchedulerEntry[] = first.upserts;
    const second = planScheduleReconciliation([routine], applied, NOW, true);
    expect(second.upserts).toHaveLength(0);
    expect(second.cancels).toHaveLength(0);
    expect(second.repairs).toHaveLength(0);
  });

  it('a disabled routine cancels its schedule and is marked repaired away', () => {
    const routine = makeRoutine({ enabled: false });
    const current: SchedulerEntry[] = [{ routineId: 'r-1', dueAt: NOW + 3_600_000 }];
    const plan = planScheduleReconciliation([routine], current, NOW, true);
    expect(plan.cancels).toEqual(['r-1']);
    expect(plan.repairs).toEqual(['r-1']);
  });

  it('master switch off cancels every schedule', () => {
    const plan = planScheduleReconciliation([makeRoutine()], [{ routineId: 'r-1', dueAt: NOW + 1 }], NOW, false);
    expect(plan.cancels).toEqual(['r-1']);
    expect(plan.upserts).toHaveLength(0);
  });

  it('an orphaned schedule for a deleted routine is repaired away — no resurrection', () => {
    const plan = planScheduleReconciliation([], [{ routineId: 'gone', dueAt: NOW + 1 }], NOW, true);
    expect(plan.cancels).toEqual(['gone']);
    expect(plan.repairs).toEqual(['gone']);
  });

  it('an overdue entry is preserved for the repair sweep — never clobbered by recomputation', () => {
    const routine = makeRoutine();
    const overdue = NOW - 60_000;
    const plan = planScheduleReconciliation([routine], [{ routineId: 'r-1', dueAt: overdue }], NOW, true);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.cancels).toHaveLength(0);
  });

  it('a schedule change re-keys the entry to the new due time', () => {
    const routine = makeRoutine({ schedule: { kind: 'daily', time: '07:30', days: 'every' } });
    const plan = planScheduleReconciliation([routine], [{ routineId: 'r-1', dueAt: NOW + 42 }], NOW, true);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]!.dueAt).not.toBe(NOW + 42);
  });
});

describe('nextAlarmTime — single-alarm multiplexing', () => {
  it('the earliest due entry wins', () => {
    expect(nextAlarmTime([{ routineId: 'a', dueAt: 300 }, { routineId: 'b', dueAt: 100 }, { routineId: 'c', dueAt: 200 }])).toBe(100);
  });

  it('no entries → no alarm', () => {
    expect(nextAlarmTime([])).toBeNull();
  });
});

describe('buildSchedulerObservation — dry-run records never masquerade as executions', () => {
  it('cloud-locus on-time occurrence → skipped / SCHEDULER_DRY_RUN with occurrence identity', () => {
    const record = buildSchedulerObservation({ routine: makeRoutine(), occurrence: 5_000, classification: { mode: 'scheduled' }, now: NOW, generation: 3, id: 'obs-1' });
    expect(record).toMatchObject({ state: 'skipped', outcome: 'skipped', errorCode: SCHEDULER_DRY_RUN_CODE, runKey: 'r-1:scheduled:5000', scheduledFor: 5_000, executionMode: 'scheduled' });
    expect(record.scheduledFor).not.toBe(NOW); // identity is the occurrence, never the processing time
  });

  it('device-locus (Google-backed) occurrence → SCHEDULER_DEVICE_DUE — the worker never executes it', () => {
    const routine = makeRoutine({ permissions: { memory: false, google: ['gmail.read'] } });
    const record = buildSchedulerObservation({ routine, occurrence: 5_000, classification: { mode: 'scheduled' }, now: NOW, generation: 3, id: 'obs-1' });
    expect(record.errorCode).toBe(SCHEDULER_DEVICE_DUE_CODE);
    expect(record.state).toBe('skipped');
  });

  it('a catch-up occurrence keeps the SOURCE occurrence identity in its runKey', () => {
    const record = buildSchedulerObservation({ routine: makeRoutine(), occurrence: 5_000, classification: { mode: 'catch-up' }, now: NOW, generation: 3, id: 'obs-1' });
    expect(record.runKey).toBe('r-1:catch-up:5000');
    expect(record.scheduledFor).toBe(5_000);
    expect(record.executionMode).toBe('catch-up');
  });

  it('a missed occurrence uses the reserved missed representation', () => {
    const record = buildSchedulerObservation({ routine: makeRoutine(), occurrence: 5_000, classification: { mode: 'missed' }, now: NOW, generation: 3, id: 'obs-1' });
    expect(record).toMatchObject({ state: 'missed', outcome: 'missed', errorCode: SCHEDULER_MISSED_CODE });
  });
});

describe('schedulerBudgetUsed — the scheduler-owned daily budget', () => {
  const base: Array<Pick<RoutineRunRecord, 'executionMode' | 'state' | 'outcome' | 'errorCode' | 'startedAt'>> = [
    { executionMode: 'scheduled', state: 'skipped', outcome: 'skipped', errorCode: SCHEDULER_DRY_RUN_CODE, startedAt: NOW - 3_600_000 },
    { executionMode: 'catch-up', state: 'skipped', outcome: 'skipped', errorCode: SCHEDULER_DRY_RUN_CODE, startedAt: NOW - 7_200_000 },
    // Not runs — never consume budget:
    { executionMode: 'scheduled', state: 'missed', outcome: 'missed', errorCode: SCHEDULER_MISSED_CODE, startedAt: NOW - 1_000 },
    { executionMode: 'scheduled', state: 'skipped', outcome: 'skipped', errorCode: SCHEDULER_OVERLAP_CODE, startedAt: NOW - 1_000 },
    { executionMode: 'manual', state: 'completed', outcome: 'no-op', errorCode: undefined, startedAt: NOW - 500 },
    // Outside the rolling day:
    { executionMode: 'scheduled', state: 'skipped', outcome: 'skipped', errorCode: SCHEDULER_DRY_RUN_CODE, startedAt: NOW - 25 * 3_600_000 },
  ];

  it('counts admitted scheduled/catch-up occurrences in the rolling 24 h only', () => {
    expect(schedulerBudgetUsed(base, NOW)).toBe(2);
  });
});
