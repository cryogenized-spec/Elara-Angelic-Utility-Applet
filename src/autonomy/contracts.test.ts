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
