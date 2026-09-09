import { describe, expect, it } from 'vitest';
import { blankDraft, customDaysLabel, draftFromRoutine, draftToRoutine } from './autonomy-draft';
import type { ElaraRoutine } from '../../autonomy/contracts';

const NOW = 1_700_000_000_000;

function makeRoutine(overrides: Partial<ElaraRoutine> = {}): ElaraRoutine {
  return {
    id: 'r-1',
    name: 'Custom days',
    enabled: true,
    instruction: 'Check things.',
    schedule: { kind: 'daily', time: '09:00', days: [1, 3, 5] },
    timezone: 'UTC',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('routine draft mapping — custom weekday preservation', () => {
  it('represents a persisted custom weekday array as its own draft state, not as "every"', () => {
    const draft = draftFromRoutine(makeRoutine());
    expect(draft.days).toBe('custom');
  });

  it('PRESERVES the exact custom array through an edit/save cycle that does not touch days', () => {
    const existing = makeRoutine();
    const draft = draftFromRoutine(existing);
    // User edits only the name; days stay on the custom option.
    const saved = draftToRoutine({ ...draft, name: 'Renamed' }, existing);
    expect(saved.schedule).toEqual({ kind: 'daily', time: '09:00', days: [1, 3, 5] });
  });

  it('rewrites the days only when the user explicitly switches to a named set', () => {
    const existing = makeRoutine();
    const draft = draftFromRoutine(existing);
    const saved = draftToRoutine({ ...draft, days: 'weekdays' }, existing);
    expect(saved.schedule).toEqual({ kind: 'daily', time: '09:00', days: 'weekdays' });
  });

  it('labels the custom option with the exact days', () => {
    expect(customDaysLabel(makeRoutine())).toBe('Custom (Mon · Wed · Fri)');
    expect(customDaysLabel(makeRoutine({ schedule: { kind: 'daily', time: '09:00', days: 'every' } }))).toBe('Custom days');
    expect(customDaysLabel(undefined)).toBe('Custom days');
  });

  it('named day sets round-trip unchanged', () => {
    for (const days of ['every', 'weekdays', 'weekends'] as const) {
      const existing = makeRoutine({ schedule: { kind: 'daily', time: '07:30', days } });
      const saved = draftToRoutine(draftFromRoutine(existing), existing);
      expect(saved.schedule).toEqual({ kind: 'daily', time: '07:30', days });
    }
  });

  it('a blank draft is never custom', () => {
    expect(blankDraft('UTC').days).toBe('every');
  });

  it('maxRunsPerDay round-trips through the draft (stored for the scheduler; not applied to manual runs)', () => {
    const existing = makeRoutine({ policy: { cooldownHours: 6, maxToolCalls: 4, maxRunsPerDay: 2 } });
    const saved = draftToRoutine(draftFromRoutine(existing), existing);
    expect(saved.policy).toEqual({ cooldownHours: 6, maxToolCalls: 4, maxRunsPerDay: 2 });
  });
});
