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

// ---------------------------------------------------------------------------
// Hardening forensics: custom day lists, DST boundaries, elapsed-time
// semantics across DST, window edges, and invalid inputs.
// ---------------------------------------------------------------------------

describe('computeNextOccurrence — hardening', () => {
  it('honours an arbitrary weekday list ([1,3,5] = Mon/Wed/Fri)', () => {
    // From Thursday 2026-01-15 12:00 UTC (14:00 SAST) → next Mon/Wed/Fri 09:00 is Friday 16th.
    expect(computeNextOccurrence(daily('09:00', [1, 3, 5]), 'Africa/Johannesburg', Date.UTC(2026, 0, 15, 12, 0))).toBe(Date.UTC(2026, 0, 16, 7, 0));
    // From Saturday 17th → Monday 19th.
    expect(computeNextOccurrence(daily('09:00', [1, 3, 5]), 'Africa/Johannesburg', Date.UTC(2026, 0, 17, 12, 0))).toBe(Date.UTC(2026, 0, 19, 7, 0));
  });

  it('fires a time at the spring-forward boundary start (02:00) at 03:00, but 01:59 normally', () => {
    // America/New_York jumps 02:00 → 03:00 on 2026-03-08.
    expect(computeNextOccurrence(daily('02:00'), 'America/New_York', Date.UTC(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 7, 0));
    expect(computeNextOccurrence(daily('01:59'), 'America/New_York', Date.UTC(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 6, 59));
  });

  it('selects the first occurrence for a mid-hour fall-back time (01:45)', () => {
    // The repeated hour on 2026-11-01 in New York is 01:00–02:00: local 01:45 occurs at
    // 05:45 UTC (EDT) and 06:45 UTC (EST) — the first occurrence is 05:45.
    expect(computeNextOccurrence(daily('01:45'), 'America/New_York', Date.UTC(2026, 9, 31, 12, 0))).toBe(Date.UTC(2026, 10, 1, 5, 45));
  });

  it('keeps interval semantics elapsed-time (DST-independent) across a spring-forward boundary', () => {
    // Anchor 2026-03-08 05:00 UTC (midnight EST), every 60 min. After the jump to EDT,
    // ticks stay at exact 60-minute UTC intervals — the local wall clock shifts, the tick does not.
    const anchor = Date.UTC(2026, 2, 8, 5, 0);
    const from = Date.UTC(2026, 2, 8, 9, 0);
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 60 }, 'America/New_York', from, { anchor })).toBe(Date.UTC(2026, 2, 8, 10, 0));
  });

  it('treats a tick exactly at the window start as inside, and at the window end as outside', () => {
    // 09:00 UTC is exactly window start → in window, next tick from 08:30 is 09:00 (in).
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 30, between: { start: '09:00', end: '17:00' } }, 'UTC', Date.UTC(2026, 0, 15, 8, 30))).toBe(Date.UTC(2026, 0, 15, 9, 0));
    // A tick landing exactly at 17:00 (end, exclusive) defers to the next opening.
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 120, between: { start: '09:00', end: '17:00' } }, 'UTC', Date.UTC(2026, 0, 15, 15, 0))).toBe(Date.UTC(2026, 0, 16, 9, 0));
  });

  it('recovers when the window opening itself falls inside a DST gap', () => {
    // Window 02:30–05:00 in New York: on 2026-03-08 the 02:30 opening does not exist → opens 03:00 EDT.
    const from = Date.UTC(2026, 2, 7, 20, 0); // 15:00 EST Mar 7 — outside the window.
    expect(computeNextOccurrence({ kind: 'interval', everyMinutes: 30, between: { start: '02:30', end: '05:00' } }, 'America/New_York', from)).toBe(Date.UTC(2026, 2, 8, 7, 0));
  });

  it('throws on an invalid timezone rather than guessing (callers pass normalized routines)', () => {
    expect(() => computeNextOccurrence(daily('09:00'), 'Mars/Olympus_Mons', Date.UTC(2026, 0, 15))).toThrow();
  });
});
