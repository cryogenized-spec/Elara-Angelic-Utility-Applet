import { z } from 'zod';
import type { GoogleCapabilityKey } from '../google/oauth/contracts';

// ---------------------------------------------------------------------------
// Autonomous Elara — routine domain contracts.
//
// This module is deliberately pure: zod schemas, types, and normalization
// only. It must stay importable from both the browser application and a
// future worker-side scheduler (the same sharing pattern as
// `src/google/tools/contracts.ts`). No browser APIs, no provider SDK, no
// persistence imports.
//
// Core invariants (see docs/AUTONOMOUS_ELARA_DESIGN.md):
// - A Routine is user intent. Structured permissions are the only authority.
// - Google-backed routines are device-native until a server-side
//   authorization authority exists. `deriveExecutionLocus` encodes that rule.
// - Autonomous Google tool use is READ-ONLY. Only read capabilities may
//   appear in `permissions.google`.
// ---------------------------------------------------------------------------

/** Read-only Google capabilities a routine may be granted. */
export const routineGoogleCapabilitySchema = z.enum([
  'calendar.events.read',
  'calendar.list.read',
  'calendar.settings.read',
  'tasks.read',
  'docs.read',
  'chat.read',
  'gmail.read',
  'drive.files.app.read',
  'drive.library.read',
  'sheets.read',
]);
export type RoutineGoogleCapability = z.infer<typeof routineGoogleCapabilitySchema>;

export const ROUTINE_GOOGLE_CAPABILITIES: readonly RoutineGoogleCapability[] = routineGoogleCapabilitySchema.options;

export const routineTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:mm time.');

export const routineDaysSchema = z.union([
  z.literal('every'),
  z.literal('weekdays'),
  z.literal('weekends'),
  z.array(z.number().int().min(0).max(6)).min(1).max(7),
]);
export type RoutineDays = z.infer<typeof routineDaysSchema>;

/** Wall-clock schedules fire at a local time in the routine's timezone. */
export const dailyScheduleSchema = z.strictObject({
  kind: z.literal('daily'),
  time: routineTimeSchema,
  days: routineDaysSchema,
});
export type DailySchedule = z.infer<typeof dailyScheduleSchema>;

/** Interval schedules are elapsed-time anchored, DST-independent. */
export const intervalScheduleSchema = z.strictObject({
  kind: z.literal('interval'),
  everyMinutes: z.number().int().min(15).max(1_440),
  between: z.strictObject({ start: routineTimeSchema, end: routineTimeSchema }).optional(),
});
export type IntervalSchedule = z.infer<typeof intervalScheduleSchema>;

export const routineScheduleSchema = z.discriminatedUnion('kind', [dailyScheduleSchema, intervalScheduleSchema]);
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;

export const routineImportanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type RoutineImportance = z.infer<typeof routineImportanceSchema>;

export const routinePermissionsSchema = z.strictObject({
  memory: z.boolean(),
  google: z.array(routineGoogleCapabilitySchema).max(ROUTINE_GOOGLE_CAPABILITIES.length),
});
export type RoutinePermissions = z.infer<typeof routinePermissionsSchema>;

export const routineDeliverySchema = z.strictObject({
  inbox: z.boolean(),
  /** Reserved for the notification phase; not yet a delivery channel. */
  push: z.boolean(),
  minImportanceForPush: routineImportanceSchema,
});
export type RoutineDelivery = z.infer<typeof routineDeliverySchema>;

export const routinePolicySchema = z.strictObject({
  cooldownHours: z.number().int().min(1).max(168),
  maxToolCalls: z.number().int().min(1).max(20),
  maxRunsPerDay: z.number().int().min(1).max(12),
});
export type RoutinePolicy = z.infer<typeof routinePolicySchema>;

export const routineRunSummarySchema = z.strictObject({
  at: z.number(),
  state: z.string(),
  outcome: z.string().optional(),
  eventId: z.string().optional(),
});
export type RoutineRunSummary = z.infer<typeof routineRunSummarySchema>;

export const elaraRoutineSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  instruction: z.string().min(1).max(4_000),
  schedule: routineScheduleSchema,
  timezone: z.string().min(1),
  permissions: routinePermissionsSchema,
  delivery: routineDeliverySchema,
  policy: routinePolicySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunAt: z.number().optional(),
  lastResult: routineRunSummarySchema.optional(),
});
export type ElaraRoutine = z.infer<typeof elaraRoutineSchema>;

/** Where a routine's *scheduled* execution belongs. Manual "Run now" is always local. */
export type RoutineExecutionLocus = 'device' | 'cloud';

export function deriveExecutionLocus(permissions: RoutinePermissions): RoutineExecutionLocus {
  return permissions.google.length > 0 ? 'device' : 'cloud';
}

export const ROUTINE_EXECUTION_MODES = ['manual', 'scheduled', 'catch-up'] as const;
export type RoutineExecutionMode = (typeof ROUTINE_EXECUTION_MODES)[number];

export const ROUTINE_RUN_STATES = ['pending', 'running', 'completed', 'skipped', 'failed', 'cancelled', 'missed'] as const;
export type RoutineRunState = (typeof ROUTINE_RUN_STATES)[number];

// Run-state semantics (authoritative):
// - 'pending'/'running': in flight. The atomic claim (claimRoutineRun) refuses
//   a second concurrent run; a stale in-flight record (crashed process, e.g.
//   the tab closed mid-run) is abandoned by the next claim after STALE_RUN_MS.
// - 'completed': the run executed to a terminal model outcome (no-op, event,
//   or suppressed).
// - 'skipped': the routine did NOT execute — an authority guard (master switch
//   off, routine disabled) or admission guard (run already in flight) stopped
//   it before any model call. Always carries an errorCode.
// - 'failed': execution was attempted but could not complete (provider
//   failure, invalid outcome contract, internal error, crash abandonment).
// - 'cancelled': deliberately stopped (abort signal / provider cancellation).
//   No 'cancelled' outcome exists — the state carries the semantics.
// - 'missed': RESERVED for the Phase B scheduler (an occurrence whose grace
//   window passed without executing). Nothing in A1 produces it.

export const ROUTINE_RUN_OUTCOMES = ['no-op', 'event', 'suppressed', 'error', 'skipped', 'missed'] as const;
export type RoutineRunOutcome = (typeof ROUTINE_RUN_OUTCOMES)[number];

// Outcome semantics (authoritative — these must never be conflated):
// - 'no-op': the run EXECUTED successfully and found nothing worth surfacing.
//   Silence is a successful outcome, not an error.
// - 'event': the run executed and its proposal PASSED the deterministic
//   admission policy; an AutonomousEvent exists and eventId is set.
// - 'suppressed': the run executed and the model PROPOSED an event, but
//   deterministic policy rejected delivery (cooldown | duplicate | daily-cap).
//   Only valid with state 'completed' and suppressedReason set. The model
//   proposed; code decided.
// - 'error': execution was attempted but could not complete.
// - 'skipped': the routine did not execute (see run states above).
// - 'missed': reserved for the scheduler (Phase B).

export const ROUTINE_SUPPRESSION_REASONS = ['cooldown', 'duplicate', 'daily-cap'] as const;
export type RoutineSuppressionReason = (typeof ROUTINE_SUPPRESSION_REASONS)[number];

export const routineRunRecordSchema = z.strictObject({
  id: z.string().min(1),
  /** Idempotency key — see routineRunKey() for per-mode identity semantics. */
  runKey: z.string().min(1),
  routineId: z.string().min(1),
  /** Denormalized so history survives routine deletion. */
  routineName: z.string().min(1),
  executionMode: z.enum(ROUTINE_EXECUTION_MODES),
  /** The occurrence this run executes: trigger time for manual, occurrence instant for scheduled/catch-up. */
  scheduledFor: z.number(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  state: z.enum(ROUTINE_RUN_STATES),
  outcome: z.enum(ROUTINE_RUN_OUTCOMES).optional(),
  suppressedReason: z.enum(ROUTINE_SUPPRESSION_REASONS).optional(),
  toolCalls: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  interactionId: z.string().optional(),
  eventId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  /** Structured no-op reason supplied by the model (never chain-of-thought). */
  reason: z.string().max(500).optional(),
  itemsExamined: z.number().int().min(0).optional(),
});
export type RoutineRunRecord = z.infer<typeof routineRunRecordSchema>;

export const routineEvidenceKinds = ['memory', 'tool', 'web'] as const;
export type RoutineEvidenceKind = (typeof routineEvidenceKinds)[number];

export const routineEvidenceSchema = z.strictObject({
  kind: z.enum(routineEvidenceKinds),
  ref: z.string().min(1).max(300),
  note: z.string().max(300).optional(),
});
export type RoutineEvidence = z.infer<typeof routineEvidenceSchema>;

export const autonomousEventSchema = z.strictObject({
  id: z.string().min(1),
  routineId: z.string().min(1),
  runKey: z.string().min(1),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(4_000),
  importance: routineImportanceSchema,
  confidence: routineImportanceSchema,
  evidence: z.array(routineEvidenceSchema).max(8),
  noveltyFingerprint: z.string().min(8).max(64),
  createdAt: z.number(),
  readAt: z.number().nullable(),
});
export type AutonomousEvent = z.infer<typeof autonomousEventSchema>;

/** Non-terminal run states: a routine with such a run is considered in flight. */
export function isRunInFlight(run: Pick<RoutineRunRecord, 'state'>): boolean {
  return run.state === 'pending' || run.state === 'running';
}

/**
 * Stable identity for ONE execution of one routine occurrence:
 * `${routineId}:${executionMode}:${scheduledFor}`.
 *
 * - manual: `scheduledFor` is the trigger timestamp — each explicit Run Now is
 *   its own execution. The key is NOT an idempotency mechanism for manual runs
 *   (two deliberate clicks are two runs); overlap is refused by the atomic
 *   claim guard, and a same-millisecond duplicate trigger collapses onto the
 *   same key and is returned as already-executed.
 * - scheduled: `scheduledFor` is the OCCURRENCE instant (computeNextOccurrence
 *   output). Redelivery of the same occurrence dedupes on the unique runKey
 *   index — the at-least-once delivery scenario.
 * - catch-up: `scheduledFor` is the SOURCE occurrence being caught up, never
 *   the catch-up trigger time, so a repeated catch-up attempt for the same
 *   missed occurrence also dedupes.
 *
 * Phase C Cloudflare Workflow instance ids derive directly from this key.
 */
export function routineRunKey(routineId: string, executionMode: RoutineExecutionMode, scheduledFor: number): string {
  return `${routineId}:${executionMode}:${scheduledFor}`;
}

// ---------------------------------------------------------------------------
// Normalization — persisted routine records are user data, like preferences:
// clamp rather than crash, but never silently reinterpret a broken schedule.
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE: RoutineSchedule = { kind: 'daily', time: '09:00', days: 'every' };
export const DEFAULT_ROUTINE_POLICY: RoutinePolicy = { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 };
export const DEFAULT_ROUTINE_DELIVERY: RoutineDelivery = { inbox: true, push: false, minImportanceForPush: 2 };
export const MAX_ROUTINES = 12;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && routineTimeSchema.safeParse(value).success ? value : fallback;
}

function normalizeDays(value: unknown): RoutineDays {
  if (value === 'weekdays' || value === 'weekends' || value === 'every') return value;
  if (Array.isArray(value)) {
    const days = [...new Set(value.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    if (days.length) return days;
  }
  return 'every';
}

function normalizeBetween(value: unknown): IntervalSchedule['between'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const start = normalizeTime(record.start, '09:00');
  const end = normalizeTime(record.end, '18:00');
  return { start, end };
}

function normalizeSchedule(value: unknown): { schedule: RoutineSchedule; valid: boolean } {
  if (!value || typeof value !== 'object') return { schedule: DEFAULT_SCHEDULE, valid: false };
  const record = value as Record<string, unknown>;
  if (record.kind === 'daily') {
    return { schedule: { kind: 'daily', time: normalizeTime(record.time, '09:00'), days: normalizeDays(record.days) }, valid: true };
  }
  if (record.kind === 'interval') {
    const everyMinutes = clampInt(record.everyMinutes, 15, 1_440, 180);
    const between = normalizeBetween(record.between);
    return { schedule: { kind: 'interval', everyMinutes, ...(between ? { between } : {}) }, valid: true };
  }
  return { schedule: DEFAULT_SCHEDULE, valid: false };
}

function normalizePermissions(value: unknown): RoutinePermissions {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const google = Array.isArray(source.google)
    ? [...new Set(source.google.filter((capability): capability is RoutineGoogleCapability => routineGoogleCapabilitySchema.safeParse(capability).success))]
    : [];
  return { memory: source.memory === true, google };
}

function normalizeDelivery(value: unknown): RoutineDelivery {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    inbox: source.inbox !== false,
    push: source.push === true,
    minImportanceForPush: source.minImportanceForPush === 1 || source.minImportanceForPush === 3 ? source.minImportanceForPush : 2,
  };
}

function normalizePolicy(value: unknown): RoutinePolicy {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    cooldownHours: clampInt(source.cooldownHours, 1, 168, DEFAULT_ROUTINE_POLICY.cooldownHours),
    maxToolCalls: clampInt(source.maxToolCalls, 1, 20, DEFAULT_ROUTINE_POLICY.maxToolCalls),
    maxRunsPerDay: clampInt(source.maxRunsPerDay, 1, 12, DEFAULT_ROUTINE_POLICY.maxRunsPerDay),
  };
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a persisted routine. A record whose schedule cannot be understood
 * is disabled rather than reinterpreted: a routine the user configured for
 * weekdays must never quietly become an every-day routine.
 */
export function normalizeRoutine(value: unknown, now = Date.now()): ElaraRoutine {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const name = safeText(source.name, 80) || 'Untitled routine';
  const instruction = typeof source.instruction === 'string' ? source.instruction.trim().slice(0, 4_000) : '';
  const { schedule, valid: scheduleValid } = normalizeSchedule(source.schedule);
  const timezone = isValidTimezone(source.timezone) ? (source.timezone as string) : 'UTC';
  const createdAt = typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : now;
  const updatedAt = typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : createdAt;
  const lastRunAt = typeof source.lastRunAt === 'number' && Number.isFinite(source.lastRunAt) ? source.lastRunAt : undefined;
  const lastResult = routineRunSummarySchema.safeParse(source.lastResult).success ? (source.lastResult as RoutineRunSummary) : undefined;
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `routine-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    name,
    enabled: scheduleValid && source.enabled === true,
    instruction: instruction || 'No instruction was saved for this routine.',
    schedule,
    timezone,
    permissions: normalizePermissions(source.permissions),
    delivery: normalizeDelivery(source.delivery),
    policy: normalizePolicy(source.policy),
    createdAt,
    updatedAt,
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    ...(lastResult ? { lastResult } : {}),
  };
}

/** Capability keys a Google tool must carry (read risk) to be routable in a routine run. */
export function routineToolCapabilities(permissions: RoutinePermissions): GoogleCapabilityKey[] {
  return [...permissions.google];
}
