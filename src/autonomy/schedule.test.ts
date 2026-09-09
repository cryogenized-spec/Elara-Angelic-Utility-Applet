import { describe, expect, it } from 'vitest';
import { computeNextOccurrence, describeSchedule, nextIntervalOccurrence, zonedWallTimeToInstant } from './schedule';
import type { RoutineDays } from './contracts';

// Timezone facts used below (stable IANA rules):
// - Africa/Johannesburg is UTC+2 year-round (no DST).
// - America/New_York springs forward 2026-03-08 (02:00 → 03:00, EST → EDT)
//   and falls back 2026-11-01 (02:00 → 01:00, EDT → EST).

const daily = (time: string, days: RoutineDays = 'every') => ({ kind: 'daily' as const, time, days });

describe('zonedWallTimeToInstant', () => {
  it('maps a Johannesburg wall time to UTC (SAST is UTC+2 year-round)', () => {
    expect(zonedWallTimeToInstant(2026, 1, 15, 9, 0, 'Africa/Johannesburg')).toBe(Date.UTC(2026, 0, 15, 7, 0));
  });

  it('returns null for a wall time inside a spring-forward gap', () => {
    expect(zonedWallTimeToInstant(2026, 3, 8, 2, 30, 'America/New_York')).toBeNull();
  });

  it('picks the FIRST occurrence of an ambiguous fall-back wall time', () => {
    // 01:30 on 2026-11-01 in New York happens twice: 05:30 UTC (EDT) and 06:30 UTC (EST).
    expect(zonedWallTimeToInstant(2026, 11, 1, 1, 30, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
});

describe('computeNextOccurrence — daily', () => {
  it('fires at the wall-clock time in the routine timezone', () => {
    expect(computeNextOccurrence(daily('09:00'), 'Africa/Johannesburg', Date.UTC(2026, 0, 15, 0, 0))).toBe(Date.UTC(2026, 0, 15, 7, 0));
  });

  it('returns an occurrence strictly after `from`', () => {
    const atNineSast = Date.UTC(2026, 0, 15, 7, 0);
    expect(computeNextOccurrence(daily('09:00'), 'Africa/Johannesburg', atNineSast)).toBe(Date.UTC(2026, 0, 16, 7, 0));
  });

  it('skips the weekend for weekday schedules (2026-01-16 is a Friday)', () => {
    expect(computeNextOccurrence(daily('09:00', 'weekdays'), 'Africa/Johannesburg', Date.UTC(2026, 0, 16, 12, 0))).toBe(Date.UTC(2026, 0, 19, 7, 0));
  });

  it('finds the next weekend day for weekend schedules', () => {
    expect(computeNextOccurrence(daily('09:00', 'weekends'), 'Africa/Johannesburg', Date.UTC(2026, 0, 16, 12, 0))).toBe(Date.UTC(2026, 0, 17, 7, 0));
  });

  it('fires a spring-forward-gap time at the first valid local minute (02:30 → 03:00 EDT)', () => {
    expect(computeNextOccurrence(daily('02:30'), 'America/New_York', Date.UTC(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 7, 0));
  });

  it('fires an ambiguous fall-back time at its first occurrence', () => {
    // From Sat 2026-10-31 12:00 UTC the next 01:30 is Sun 2026-11-01, which
    // occurs twice (01:30 EDT then 01:30 EST) — the first instance is 05:30 UTC.
    expect(computeNextOccurrence(daily('01:30'), 'America/New_York', Date.UTC(2026, 9, 31, 12, 0))).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
});

describe('computeNextOccurrence — interval', () => {
  it('ticks elapsed time from the anchor, DST-independent', () => {
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 60 }, 'UTC', 10_000, { anchor: 0 })).toBe(3_600_000);
  });

  it('returns the anchor itself when `from` precedes it', () => {
    expect(nextIntervalOccurrence({ kind: 'interval', everyMinutes: 15 }, 0, 1_000)).toBe(1_000);
  });

  it('defers an out-of-window tick to the next window opening', () => {
    const from = Date.UTC(2026, 0, 15, 20, 0); // 20:00 — after the 09:00–17:00 window.
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 60, between: { start: '09:00', end: '17:00' } }, 'UTC', from)).toBe(Date.UTC(2026, 0, 16, 9, 0));
  });

  it('keeps ticks inside a wrap-around (overnight) window', () => {
    const from = Date.UTC(2026, 0, 15, 23, 0); // 23:00 is inside a 22:00–02:00 window.
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 30, between: { start: '22:00', end: '02:00' } }, 'UTC', from)).toBe(Date.UTC(2026, 0, 15, 23, 30));
  });
});

describe('describeSchedule', () => {
  it('labels daily schedules', () => {
    expect(describeSchedule(daily('09:00'))).toBe('Every day · 09:00');
    expect(describeSchedule(daily('09:00', [1, 3, 5]))).toBe('Mon · Wed · Fri · 09:00');
  });

  it('labels interval schedules, including waking windows', () => {
    expect(describeSchedule({ kind: 'interval', everyMinutes: 45 })).toBe('Every 45 min');
    expect(describeSchedule({ kind: 'interval', everyMinutes: 120, between: { start: '09:00', end: '18:00' } })).toBe('Every 2 h · 09:00–18:00');
  });
});
