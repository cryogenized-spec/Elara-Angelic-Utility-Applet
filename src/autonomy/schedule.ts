import type { RoutineDays, RoutineSchedule } from './contracts';

// ---------------------------------------------------------------------------
// Routine due-time computation.
//
// PURE domain code and the scheduling truth of the autonomy system: the
// future Cloudflare scheduler (Phase B) will consume exactly these functions
// through the SchedulerPort; nothing here may depend on Cloudflare, the
// browser, or persistence.
//
// Semantics (design doc §7.3):
// - `daily` schedules are wall-clock in the routine's IANA timezone.
//   - DST spring-forward gap (wall time does not exist): fire at the first
//     valid local minute after the gap (e.g. 02:30 → 03:00 local).
//   - DST fall-back ambiguity (wall time occurs twice): fire at the FIRST
//     occurrence.
// - `interval` schedules are elapsed time anchored at a caller-supplied
//   anchor (routine creation / last scheduled run), DST-independent, with an
//   optional local waking-hours window.
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PARTS_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', { ...PARTS_FORMAT_OPTIONS, timeZone });
}

function zonedParts(instant: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const record: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') record[part.type] = part.value;
  return {
    year: Number(record.year),
    month: Number(record.month),
    day: Number(record.day),
    hour: Number(record.hour),
    minute: Number(record.minute),
  };
}

/** Offset of the zone's wall clock from UTC at `instant`, in ms (positive east of UTC). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

function sameWallClock(parts: ZonedParts, year: number, month: number, day: number, hour: number, minute: number): boolean {
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
}

/**
 * UTC instant of a wall-clock time in `timeZone`, or null when that wall time
 * does not exist (DST spring-forward gap). For ambiguous times the FIRST
 * occurrence is returned.
 */
export function zonedWallTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number | null {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = zoneOffsetMs(guess, timeZone);
    const next = naive - offset;
    if (next === guess) break;
    guess = next;
  }
  if (!sameWallClock(zonedParts(guess, timeZone), year, month, day, hour, minute)) return null;
  // Fall-back ambiguity: if one hour earlier maps to the same wall clock, that
  // is the first occurrence.
  const earlier = guess - 3_600_000;
  if (sameWallClock(zonedParts(earlier, timeZone), year, month, day, hour, minute)) return earlier;
  return guess;
}

function parseTime(time: string): [hour: number, minute: number] {
  const [hour, minute] = time.split(':');
  return [Number(hour), Number(minute)];
}

function utcCalendarDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function addCalendarDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(utcCalendarDay(year, month, day) + days * 86_400_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(utcCalendarDay(year, month, day)).getUTCDay();
}

function dayMatches(days: RoutineDays, weekday: number): boolean {
  if (days === 'every') return true;
  if (days === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (days === 'weekends') return weekday === 0 || weekday === 6;
  return days.includes(weekday);
}

/**
 * First valid instant at or after a wall-clock time that falls inside a DST
 * gap. Example: 02:30 on a 02:00→03:00 spring-forward day fires at 03:00.
 */
function firstValidInstantAfterGap(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  let currentHour = hour;
  let currentMinute = minute;
  for (let step = 0; step < 180; step += 1) {
    currentMinute += 1;
    if (currentMinute === 60) { currentMinute = 0; currentHour += 1; }
    if (currentHour === 24) {
      const nextDay = addCalendarDays(year, month, day, 1);
      const instant = zonedWallTimeToInstant(nextDay.year, nextDay.month, nextDay.day, 0, currentMinute, timeZone);
      if (instant !== null) return instant;
      continue;
    }
    const instant = zonedWallTimeToInstant(year, month, day, currentHour, currentMinute, timeZone);
    if (instant !== null) return instant;
  }
  return Date.UTC(year, month - 1, day, hour, minute);
}

function dailyOccurrenceOn(
  year: number,
  month: number,
  day: number,
  time: string,
  timeZone: string,
): number {
  const [hour, minute] = parseTime(time);
  const instant = zonedWallTimeToInstant(year, month, day, hour, minute, timeZone);
  if (instant !== null) return instant;
  return firstValidInstantAfterGap(year, month, day, hour, minute, timeZone);
}

/** Next occurrence of a daily (wall-clock) schedule strictly after `from`. */
export function nextDailyOccurrence(schedule: Extract<RoutineSchedule, { kind: 'daily' }>, timeZone: string, from: number): number {
  const fromParts = zonedParts(from, timeZone);
  // Eight calendar days always covers a full weekday cycle, including DST weeks.
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const date = addCalendarDays(fromParts.year, fromParts.month, fromParts.day, dayOffset);
    if (!dayMatches(schedule.days, weekdayOf(date.year, date.month, date.day))) continue;
    const instant = dailyOccurrenceOn(date.year, date.month, date.day, schedule.time, timeZone);
    if (instant > from) return instant;
  }
  throw new Error('A daily schedule must produce an occurrence within eight days.');
}

/** Next interval tick strictly after `from`, anchored at `anchor` (elapsed time, DST-free). */
export function nextIntervalOccurrence(schedule: Extract<RoutineSchedule, { kind: 'interval' }>, from: number, anchor: number): number {
  const step = schedule.everyMinutes * 60_000;
  const safeAnchor = Number.isFinite(anchor) ? anchor : from;
  if (from < safeAnchor) return safeAnchor;
  const elapsed = from - safeAnchor;
  const ticks = Math.floor(elapsed / step);
  return safeAnchor + (ticks + 1) * step;
}

function withinWindow(instant: number, between: { start: string; end: string }, timeZone: string): boolean {
  const parts = zonedParts(instant, timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  const [startHour, startMinute] = parseTime(between.start);
  const [endHour, endMinute] = parseTime(between.end);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Advance an instant to the next opening of the local waking-hours window. */
function nextWindowOpening(instant: number, between: { start: string; end: string }, timeZone: string): number {
  const [startHour, startMinute] = parseTime(between.start);
  const parts = zonedParts(instant, timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  const [endHour, endMinute] = parseTime(between.end);
  const end = endHour * 60 + endMinute;
  const alreadyPastEnd = startHour * 60 + startMinute <= end ? minutes >= end : minutes < end && minutes < startHour * 60 + startMinute;
  const date = alreadyPastEnd ? addCalendarDays(parts.year, parts.month, parts.day, 1) : parts;
  const opening = zonedWallTimeToInstant(date.year, date.month, date.day, startHour, startMinute, timeZone);
  if (opening !== null && opening > instant) return opening;
  // A window opening that itself falls into a DST gap: fall back to the next
  // valid minute after it.
  if (opening !== null) return opening;
  const nextDate = addCalendarDays(date.year, date.month, date.day, 0);
  return firstValidInstantAfterGap(nextDate.year, nextDate.month, nextDate.day, startHour, startMinute, timeZone);
}

export interface NextOccurrenceOptions {
  /** Interval anchor; defaults to `from` (first tick one interval from now). */
  anchor?: number;
}

/** Next due instant of any routine schedule strictly after `from`. */
export function computeNextOccurrence(schedule: RoutineSchedule, timeZone: string, from: number, options: NextOccurrenceOptions = {}): number {
  if (schedule.kind === 'daily') return nextDailyOccurrence(schedule, timeZone, from);
  let next = nextIntervalOccurrence(schedule, from, options.anchor ?? from);
  if (schedule.between) {
    for (let attempt = 0; attempt < 4 && !withinWindow(next, schedule.between, timeZone); attempt += 1) {
      next = nextWindowOpening(next, schedule.between, timeZone);
    }
  }
  return next;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeDays(days: RoutineDays): string {
  if (days === 'every') return 'Every day';
  if (days === 'weekdays') return 'Weekdays';
  if (days === 'weekends') return 'Weekends';
  if (days.length === 7) return 'Every day';
  return days.map((day) => WEEKDAY_LABELS[day]).join(' · ');
}

/** Human-readable schedule label for the UI (no scheduling machinery implied). */
export function describeSchedule(schedule: RoutineSchedule): string {
  if (schedule.kind === 'daily') return `${describeDays(schedule.days)} · ${schedule.time}`;
  const every = schedule.everyMinutes % 60 === 0 ? `${schedule.everyMinutes / 60} h` : `${schedule.everyMinutes} min`;
  if (!schedule.between) return `Every ${every}`;
  return `Every ${every} · ${schedule.between.start}–${schedule.between.end}`;
}
