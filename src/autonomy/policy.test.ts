import { describe, expect, it } from 'vitest';
import { evaluateEventAdmission, noveltyFingerprint } from './policy';
import { DEFAULT_ROUTINE_POLICY } from './contracts';

const NOW = Date.UTC(2026, 0, 15, 12, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function recentEvent(overrides: Partial<{ routineId: string; noveltyFingerprint: string; createdAt: number }> = {}) {
  return { routineId: 'r-1', noveltyFingerprint: 'aaaaaaaaaaaaaaaa', createdAt: NOW - HOUR, ...overrides };
}

describe('noveltyFingerprint', () => {
  it('is deterministic and insensitive to case and whitespace', () => {
    const a = noveltyFingerprint('r-1', 'Calendar moved', 'The  nine  o’clock was pushed.');
    const b = noveltyFingerprint('r-1', 'calendar  moved', 'the nine o’clock was pushed. ');
    expect(a).toBe(b);
  });

  it('changes with the routine, the title, or the summary', () => {
    const base = noveltyFingerprint('r-1', 'Title', 'Summary');
    expect(noveltyFingerprint('r-2', 'Title', 'Summary')).not.toBe(base);
    expect(noveltyFingerprint('r-1', 'Other title', 'Summary')).not.toBe(base);
    expect(noveltyFingerprint('r-1', 'Title', 'Other summary')).not.toBe(base);
  });

  it('produces a 16-hex-char key', () => {
    expect(noveltyFingerprint('r-1', 't', 's')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('evaluateEventAdmission', () => {
  const input = (overrides: Partial<Parameters<typeof evaluateEventAdmission>[0]> = {}) => ({
    routineId: 'r-1',
    fingerprint: noveltyFingerprint('r-1', 'Fresh title', 'Fresh summary'),
    recentEvents: [] as ReturnType<typeof recentEvent>[],
    policy: DEFAULT_ROUTINE_POLICY,
    maxEventsPerDay: 10,
    now: NOW,
    ...overrides,
  });

  it('admits when nothing recent stands in the way', () => {
    expect(evaluateEventAdmission(input())).toEqual({ admitted: true });
  });

  it('suppresses on cooldown when the same routine delivered recently', () => {
    const decision = evaluateEventAdmission(input({ recentEvents: [recentEvent({ noveltyFingerprint: 'different', createdAt: NOW - 2 * HOUR })] }));
    expect(decision).toMatchObject({ admitted: false, reason: 'cooldown' });
  });

  it('does not apply another routine’s cooldown', () => {
    const decision = evaluateEventAdmission(input({ recentEvents: [recentEvent({ routineId: 'r-2', noveltyFingerprint: 'different', createdAt: NOW - 2 * HOUR })] }));
    expect(decision).toEqual({ admitted: true });
  });

  it('suppresses duplicates within the 7-day window even after cooldown has passed', () => {
    const fingerprint = noveltyFingerprint('r-1', 'Fresh title', 'Fresh summary');
    const decision = evaluateEventAdmission(input({
      fingerprint,
      policy: { ...DEFAULT_ROUTINE_POLICY, cooldownHours: 1 },
      recentEvents: [recentEvent({ noveltyFingerprint: fingerprint, createdAt: NOW - 3 * DAY })],
    }));
    expect(decision).toMatchObject({ admitted: false, reason: 'duplicate' });
  });

  it('admits a repeat once the fingerprint ages out of the window', () => {
    const fingerprint = noveltyFingerprint('r-1', 'Fresh title', 'Fresh summary');
    const decision = evaluateEventAdmission(input({
      fingerprint,
      policy: { ...DEFAULT_ROUTINE_POLICY, cooldownHours: 1 },
      recentEvents: [recentEvent({ noveltyFingerprint: fingerprint, createdAt: NOW - 8 * DAY })],
    }));
    expect(decision).toEqual({ admitted: true });
  });

  it('suppresses on the rolling daily cap across all routines', () => {
    const decision = evaluateEventAdmission(input({
      maxEventsPerDay: 2,
      recentEvents: [
        recentEvent({ routineId: 'r-2', noveltyFingerprint: 'f1', createdAt: NOW - HOUR }),
        recentEvent({ routineId: 'r-3', noveltyFingerprint: 'f2', createdAt: NOW - 2 * HOUR }),
      ],
    }));
    expect(decision).toMatchObject({ admitted: false, reason: 'daily-cap' });
  });

  it('counts only events inside the rolling 24 hours toward the cap', () => {
    const decision = evaluateEventAdmission(input({
      maxEventsPerDay: 2,
      recentEvents: [
        recentEvent({ routineId: 'r-2', noveltyFingerprint: 'f1', createdAt: NOW - 25 * HOUR }),
        recentEvent({ routineId: 'r-3', noveltyFingerprint: 'f2', createdAt: NOW - 2 * HOUR }),
      ],
    }));
    expect(decision).toEqual({ admitted: true });
  });

  it('prefers the cooldown reason when several rules match', () => {
    const fingerprint = noveltyFingerprint('r-1', 'Fresh title', 'Fresh summary');
    const decision = evaluateEventAdmission(input({
      maxEventsPerDay: 1,
      fingerprint,
      recentEvents: [
        recentEvent({ noveltyFingerprint: fingerprint, createdAt: NOW - 2 * HOUR }),
        recentEvent({ routineId: 'r-2', noveltyFingerprint: 'f2', createdAt: NOW - HOUR }),
      ],
    }));
    expect(decision).toMatchObject({ admitted: false, reason: 'cooldown' });
  });
});
