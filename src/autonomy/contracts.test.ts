import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTINES,
  deriveExecutionLocus,
  normalizeRoutine,
  routineRunKey,
} from './contracts';
import { evaluateAutonomyPermission } from './authority';
import type { AutonomyPreferences } from '../domain/preferences';

const baseRoutine = {
  id: 'r-1',
  name: 'Morning brief',
  enabled: true,
  instruction: 'Check my calendar and tell me about morning changes.',
  schedule: { kind: 'daily', time: '09:00', days: 'weekdays' },
  timezone: 'Africa/Johannesburg',
  permissions: { memory: false, google: [] },
  delivery: { inbox: true, push: false, minImportanceForPush: 2 },
  policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
  createdAt: 1_000,
  updatedAt: 1_000,
};

describe('normalizeRoutine', () => {
  it('passes a valid record through with autonomy enabled', () => {
    const routine = normalizeRoutine(baseRoutine);
    expect(routine).toEqual(baseRoutine);
    expect(routine.enabled).toBe(true);
  });

  it('collapses whitespace in the name and clamps policy values', () => {
    const routine = normalizeRoutine({ ...baseRoutine, name: '  Morning   brief ', policy: { cooldownHours: 999, maxToolCalls: 0, maxRunsPerDay: 4 } });
    expect(routine.name).toBe('Morning brief');
    expect(routine.policy).toEqual({ cooldownHours: 168, maxToolCalls: 1, maxRunsPerDay: 4 });
  });

  it('disables a routine whose schedule cannot be understood instead of reinterpreting it', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'hourly' } });
    expect(routine.enabled).toBe(false);
    expect(routine.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'every' });
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(normalizeRoutine({ ...baseRoutine, timezone: 'Mars/Olympus_Mons' }).timezone).toBe('UTC');
  });

  it('filters unknown and duplicate Google capabilities', () => {
    const routine = normalizeRoutine({ ...baseRoutine, permissions: { memory: 'yes', google: ['tasks.read', 'tasks.read', 'gmail.read', 'gmail.write'] } });
    expect(routine.permissions).toEqual({ memory: false, google: ['tasks.read', 'gmail.read'] });
  });

  it('drops an unreadable last-run summary but keeps a readable one', () => {
    expect(normalizeRoutine({ ...baseRoutine, lastResult: { nonsense: true } }).lastResult).toBeUndefined();
    expect(normalizeRoutine({ ...baseRoutine, lastResult: { at: 5, state: 'completed', outcome: 'no-op' } }).lastResult).toEqual({ at: 5, state: 'completed', outcome: 'no-op' });
  });

  it('replaces an empty instruction with an explicit placeholder rather than running blind', () => {
    expect(normalizeRoutine({ ...baseRoutine, instruction: '   ' }).instruction).toBe('No instruction was saved for this routine.');
  });
});

describe('routine limits and keys', () => {
  it('caps the routine library size', () => {
    expect(MAX_ROUTINES).toBeLessThanOrEqual(12);
  });

  it('builds run keys from routine, execution mode, and scheduled time', () => {
    expect(routineRunKey('r-1', 'manual', 123)).toBe('r-1:manual:123');
    expect(routineRunKey('r-1', 'scheduled', 123)).not.toBe(routineRunKey('r-1', 'manual', 123));
  });
});

describe('deriveExecutionLocus', () => {
  it('keeps Google-backed routines device-native and others cloud-native', () => {
    expect(deriveExecutionLocus({ memory: true, google: ['tasks.read'] })).toBe('device');
    expect(deriveExecutionLocus({ memory: true, google: [] })).toBe('cloud');
  });
});

describe('evaluateAutonomyPermission', () => {
  const settings: AutonomyPreferences = { enabled: true, maxEventsPerDay: 10 };

  it('permits only when the master switch and the routine are both on', () => {
    expect(evaluateAutonomyPermission(settings, normalizeRoutine(baseRoutine))).toEqual({ permitted: true });
    expect(evaluateAutonomyPermission({ ...settings, enabled: false }, normalizeRoutine(baseRoutine))).toEqual({ permitted: false, reason: 'master-disabled' });
    expect(evaluateAutonomyPermission(settings, normalizeRoutine({ ...baseRoutine, enabled: false }))).toEqual({ permitted: false, reason: 'routine-disabled' });
  });

  it('denies on the master switch first regardless of routine state', () => {
    expect(evaluateAutonomyPermission({ ...settings, enabled: false }, normalizeRoutine({ ...baseRoutine, enabled: false }))).toEqual({ permitted: false, reason: 'master-disabled' });
  });
});

// ---------------------------------------------------------------------------
// Hardening: full-garbage records and tampered persisted permissions.
// ---------------------------------------------------------------------------

describe('normalizeRoutine — malformed recognized schedules fail closed', () => {
  it('disables a daily schedule with an invalid time instead of repairing it to 09:00', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: 'garbage', days: 'weekdays' } });
    expect(routine.enabled).toBe(false);
    expect(routine.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'every' });
  });

  it('disables a daily schedule with an invalid days value instead of repairing it to every-day', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: '07:30', days: 'garbage' } });
    expect(routine.enabled).toBe(false);
    expect(routine.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'every' });
  });

  it('disables a daily schedule with an empty weekday array (no fireable day)', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: '07:30', days: [] } });
    expect(routine.enabled).toBe(false);
  });

  it('disables an interval schedule with an untrustworthy duration instead of clamping it', () => {
    for (const everyMinutes of [0, 14, 1_441, 12.5, Number.NaN, 'fast']) {
      const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'interval', everyMinutes: everyMinutes as never } });
      expect(routine.enabled, `everyMinutes=${String(everyMinutes)}`).toBe(false);
      expect(routine.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'every' });
    }
  });

  it('disables an interval schedule with a malformed waking window instead of inventing one', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'interval', everyMinutes: 60, between: { start: '9am', end: '18:00' } } });
    expect(routine.enabled).toBe(false);
  });

  it('treats an explicit null waking window as absent (meaning-preserving)', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'interval', everyMinutes: 60, between: null } });
    expect(routine.enabled).toBe(true);
    expect(routine.schedule).toEqual({ kind: 'interval', everyMinutes: 60 });
  });

  it('fails closed when only one field of a mixed-validity schedule is malformed', () => {
    const badTimeGoodDays = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: '25:99', days: 'weekdays' } });
    expect(badTimeGoodDays.enabled).toBe(false);
    const goodTimeBadDays = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: '07:30', days: { mon: true } } });
    expect(goodTimeBadDays.enabled).toBe(false);
  });

  it('still normalizes VALID schedules, canonicalizing weekday arrays without changing meaning', () => {
    const routine = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'daily', time: '07:30', days: [5, 1, 1, 3, 3] } });
    expect(routine.enabled).toBe(true);
    expect(routine.schedule).toEqual({ kind: 'daily', time: '07:30', days: [1, 3, 5] });
    const interval = normalizeRoutine({ ...baseRoutine, schedule: { kind: 'interval', everyMinutes: 90, between: { start: '09:00', end: '17:30' } } });
    expect(interval.enabled).toBe(true);
    expect(interval.schedule).toEqual({ kind: 'interval', everyMinutes: 90, between: { start: '09:00', end: '17:30' } });
  });
});

describe('normalizeRoutine — malformed persisted state', () => {
  it('turns a garbage record into a disabled, fully-defaulted routine instead of crashing', () => {
    const routine = normalizeRoutine({ garbage: true });
    expect(routine).toMatchObject({
      name: 'Untitled routine',
      enabled: false,
      instruction: 'No instruction was saved for this routine.',
      timezone: 'UTC',
      permissions: { memory: false, google: [] },
    });
    expect(routine.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'every' });
  });

  it('drops write-class and unknown capabilities from tampered persisted permissions', () => {
    const routine = normalizeRoutine({
      ...baseRoutine,
      permissions: { memory: true, google: ['tasks.read', 'tasks.write', 'gmail.modify', 'documents.local', 'made-up.read', 'drive.library.write'] },
    });
    expect(routine.permissions).toEqual({ memory: true, google: ['tasks.read'] });
  });
});
