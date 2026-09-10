import { computeNextOccurrence } from './schedule';
import { deriveExecutionLocus, routineRunKey, type ElaraRoutine, type RoutineRunRecord, type RoutineSchedule } from './contracts';

// ---------------------------------------------------------------------------
// Cloud scheduler domain — Phase B (design doc §4.4, §7).
//
// PURE shared code: the browser app, the Worker, and the Durable Object all
// import exactly these definitions. Nothing here may depend on Cloudflare,
// the browser, persistence, or a wake mechanism — when to fire is domain
// truth; HOW the wake happens lives behind the SchedulerPort/WakeSource seam
// (worker/src/autonomy/ports.ts).
//
// Occurrence identity is load-bearing: a due occurrence is an INSTANT
// (computeNextOccurrence output) and every record derived from it keys on
// routineRunKey(routineId, mode, occurrence). It must never silently become
// the time the scheduler noticed it, nor the time the Worker executed it.
// ---------------------------------------------------------------------------

/** An occurrence processed within this window of its instant is "on time" (alarm jitter, deploy blips). */
export const SCHEDULER_ON_TIME_TOLERANCE_MS = 5 * 60_000;

/**
 * A cloud 'pending'/'running' run older than this is a crashed run. Scoped
 * per execution locus (the A1 status note requires this): the local 15-minute
 * STALE_RUN_MS in src/persistence/autonomy.ts covers local budgets; this
 * constant covers the Durable Object's own runs table.
 */
/**
 * Phase B used a 15-minute stale window. Phase C0 forbids abandoning a cloud
 * `running` claim on wall-clock alone — Workflow liveness is the recovery
 * oracle. Callers that still pass a stale window (tests of decideRunClaim)
 * may override; the DO uses Number.MAX_SAFE_INTEGER.
 */
export const CLOUD_STALE_RUN_MS = Number.MAX_SAFE_INTEGER;

/** Bounded cloud run history — mirrors the local retention contract (30 d / 1 000). */
export const CLOUD_RUN_RETENTION_MS = 30 * 24 * 3_600_000;
export const CLOUD_RUN_RETENTION_COUNT = 1_000;
export const CLOUD_EVENT_RETENTION_MS = 90 * 24 * 3_600_000;
export const CLOUD_EVENT_RETENTION_COUNT = 500;

/** The scheduler decision journal is a bounded ring, not an unbounded ledger. */
export const SCHEDULER_JOURNAL_MAX = 200;

// Error codes for scheduler observation records. These are SCHEDULER
// observations, never model executions — the run history must make that
// distinction obvious (a dry-run occurrence must not masquerade as a run).
/** Cloud-locus occurrence observed due; Phase C will execute it. Phase B records the observation only. */
export const SCHEDULER_DRY_RUN_CODE = 'SCHEDULER_DRY_RUN';
/** Device-locus occurrence observed due; the device executes it (Phase F catch-up), never the Worker. */
export const SCHEDULER_DEVICE_DUE_CODE = 'SCHEDULER_DEVICE_DUE';
/** The occurrence's grace window passed without executing — the reserved 'missed' semantics, now produced by the scheduler. */
export const SCHEDULER_MISSED_CODE = 'SCHEDULER_MISSED';
/** The routine's scheduled-run budget (policy.maxRunsPerDay) is exhausted for the rolling day. */
export const SCHEDULER_BUDGET_CODE = 'SCHEDULER_BUDGET_EXCEEDED';
/** Another run for the routine is still in flight; the overlap was refused explicitly. */
export const SCHEDULER_OVERLAP_CODE = 'RUN_IN_FLIGHT';
/** A crashed in-flight run was abandoned (tombstoned) so it cannot swallow its occurrence forever. */
export const RUN_ABANDONED_CODE = 'RUN_ABANDONED';
/** Cloud run's frozen configGeneration no longer matches live DO meta — C2 stale-run protection. */
export const STALE_GENERATION_CODE = 'STALE_GENERATION';

export const SCHEDULER_JOURNAL_KINDS = [
  'heartbeat',
  'alarm',
  'alarm-retry',
  'registered',
  'rescheduled',
  'cancelled',
  'repaired',
  'dry-run',
  'device-due',
  'missed',
  'budget-exceeded',
  'overlap-prevented',
  'already-executed',
  'routine-disabled',
  'routine-missing',
  'config-sync',
  'context-sync',
  'context-clear',
  'claimed',
  'dispatched',
  'dispatch-failed',
  'recovered',
  'completed',
  'cancelled-admission',
  'stale-generation',
  'error',
] as const;
export type SchedulerJournalKind = (typeof SCHEDULER_JOURNAL_KINDS)[number];

export interface SchedulerJournalEntry {
  at: number;
  kind: SchedulerJournalKind;
  generation: number;
  routineId?: string;
  occurrence?: number;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Due classification (design §7.3 grace windows)
// ---------------------------------------------------------------------------

export type DueClassification = { mode: 'scheduled' } | { mode: 'catch-up' } | { mode: 'missed' };

/**
 * Grace window for a MISSED occurrence (design §7.3): intervals get
 * `min(half the interval, 6 h)`; daily schedules stay catch-up-eligible until
 * their NEXT scheduled occurrence (weekday sets can legitimately span days).
 */
export function occurrenceGraceUntil(schedule: RoutineSchedule, timeZone: string, occurrence: number): number {
  if (schedule.kind === 'interval') {
    return occurrence + Math.min(schedule.everyMinutes * 30_000, 6 * 3_600_000);
  }
  return computeNextOccurrence(schedule, timeZone, occurrence);
}

/**
 * Classify a due occurrence at processing time:
 * - within the on-time tolerance of its instant → 'scheduled' (the alarm fired on time);
 * - past tolerance but inside the grace window → 'catch-up' (the repair sweep found it late);
 * - beyond grace → 'missed' (the reserved representation — the occurrence is
 *   honestly recorded as never executed, never repaired into a late run).
 *
 * The same occurrence ALWAYS classifies the same way for the same `now`;
 * identity is the occurrence instant, never the classification time.
 */
export function classifyDueOccurrence(schedule: RoutineSchedule, timeZone: string, occurrence: number, now: number): DueClassification {
  if (now - occurrence <= SCHEDULER_ON_TIME_TOLERANCE_MS) return { mode: 'scheduled' };
  if (now < occurrenceGraceUntil(schedule, timeZone, occurrence)) return { mode: 'catch-up' };
  return { mode: 'missed' };
}

// ---------------------------------------------------------------------------
// Run admission (the DO-side twin of claimRoutineRun's decision tree)
// ---------------------------------------------------------------------------

export interface ClaimRunRecord {
  id: string;
  runKey: string;
  routineId: string;
  state: RoutineRunRecord['state'];
  startedAt: number;
}

export type RunClaimDecision =
  | { action: 'already-executed'; run: ClaimRunRecord }
  | { action: 'in-flight'; run: ClaimRunRecord }
  | { action: 'claim'; abandoned: ClaimRunRecord | null };

/**
 * Decide ONE run claim against a routine's existing run records. This is the
 * same decision tree the local claimRoutineRun applies (duplicated here as a
 * PURE function because the local one is bound to Dexie): a terminal
 * duplicate is an idempotent redelivery, a fresh in-flight duplicate refuses
 * the overlap, and a STALE in-flight run is abandoned — tombstoned with a
 * `#abandoned-<id>` runKey so the canonical occurrence key is freed — before
 * this claim takes the occurrence. The Durable Object serializes all access,
 * so check-and-set is atomic by construction there.
 */
export function decideRunClaim(existing: readonly ClaimRunRecord[], runKey: string, routineId: string, now: number, staleMs = CLOUD_STALE_RUN_MS): RunClaimDecision {
  const duplicate = existing.find((candidate) => candidate.runKey === runKey);
  if (duplicate) {
    const inFlight = duplicate.state === 'pending' || duplicate.state === 'running';
    if (!inFlight) return { action: 'already-executed', run: duplicate };
    if (now - duplicate.startedAt < staleMs) return { action: 'in-flight', run: duplicate };
    return { action: 'claim', abandoned: duplicate };
  }
  const inFlight = existing.find((candidate) => (candidate.state === 'pending' || candidate.state === 'running') && now - candidate.startedAt < staleMs);
  if (inFlight) return { action: 'in-flight', run: inFlight };
  const stale = existing.find((candidate) => (candidate.state === 'pending' || candidate.state === 'running') && now - candidate.startedAt >= staleMs);
  return { action: 'claim', abandoned: stale ?? null };
}

/** Tombstone key that frees a crashed run's canonical occurrence key while keeping the crash in history. */
export function abandonedRunKey(run: ClaimRunRecord): string {
  return `${run.runKey}#abandoned-${run.id}`;
}

// ---------------------------------------------------------------------------
// Schedule reconciliation (deterministic, safe under repeated delivery)
// ---------------------------------------------------------------------------

export interface SchedulerEntry {
  routineId: string;
  dueAt: number;
}

export interface ReconciliationPlan {
  upserts: SchedulerEntry[];
  cancels: string[];
  /** Scheduler rows repaired away (routine deleted/disabled/missing from the mirror). */
  repairs: string[];
}

/**
 * Deterministically reconcile the scheduler table against the authoritative
 * routine mirror. Idempotent by natural key (routineId): the same mirror and
 * the same current state always produce the same plan, so repeated config
 * syncs, cron retries, duplicate wakes, and DO restarts cannot multiply
 * schedules or resurrect deleted routines.
 *
 * Interval anchoring: the SINGLE anchor is the routine's createdAt (the
 * design's "re-anchored on each run" is equivalent on-grid and a createdAt
 * grid cannot oscillate between alarm-driven re-arms and heartbeat-driven
 * repairs — deliberate deviation, documented in the Phase B status notes).
 */
export function planScheduleReconciliation(routines: readonly ElaraRoutine[], current: readonly SchedulerEntry[], now: number, masterEnabled: boolean): ReconciliationPlan {
  const plan: ReconciliationPlan = { upserts: [], cancels: [], repairs: [] };
  const byRoutine = new Map(current.map((entry) => [entry.routineId, entry]));
  for (const routine of routines) {
    const existing = byRoutine.get(routine.id);
    byRoutine.delete(routine.id);
    if (!masterEnabled || !routine.enabled) {
      if (existing) {
        plan.cancels.push(routine.id);
        if (!routine.enabled) plan.repairs.push(routine.id);
      }
      continue;
    }
    // An OVERDUE row is an unprocessed appointment (deploy gap, missed
    // alarm): reconciliation must PRESERVE it for the repair sweep to
    // process — recomputing the next future due here would silently erase the
    // owed occurrence. processDue advances the schedule after processing.
    if (existing && existing.dueAt <= now) continue;
    const dueAt = computeNextOccurrence(routine.schedule, routine.timezone, now, { anchor: routine.createdAt });
    if (!existing || existing.dueAt !== dueAt) plan.upserts.push({ routineId: routine.id, dueAt });
  }
  // Schedules whose routine vanished from the mirror (deleted upstream, or
  // corrupted scheduler state): a deleted routine must never resurrect from a
  // stale scheduler row.
  for (const orphan of byRoutine.values()) {
    plan.cancels.push(orphan.routineId);
    plan.repairs.push(orphan.routineId);
  }
  return plan;
}

/** The single alarm instant: the earliest due entry, or null when nothing is scheduled. */
export function nextAlarmTime(entries: readonly SchedulerEntry[]): number | null {
  return entries.length ? Math.min(...entries.map((entry) => entry.dueAt)) : null;
}

/**
 * Next due instant after a processed occurrence. Recovery MUST call this with
 * the original occurrence, never wall-clock `now`: recomputing from recovery
 * time can skip intervening occurrences.
 */
export function nextOccurrenceAfterProcessed(routine: ElaraRoutine, occurrence: number): number {
  return computeNextOccurrence(routine.schedule, routine.timezone, occurrence, { anchor: routine.createdAt });
}

// ---------------------------------------------------------------------------
// Scheduler observation records
// ---------------------------------------------------------------------------

export interface SchedulerObservationInput {
  routine: ElaraRoutine;
  /** The source occurrence instant — the identity, never the processing time. */
  occurrence: number;
  classification: DueClassification;
  now: number;
  /** Internal state generation the decision was made against (stale-config detection). */
  generation: number;
  id: string;
}

/**
 * Build the durable record for one scheduler observation. Phase B is DRY-RUN:
 * the scheduler successfully determined the routine was due and deliberately
 * did not execute it. The record says so explicitly —
 * - cloud-locus: skipped / SCHEDULER_DRY_RUN (execution arrives in Phase C);
 * - device-locus: skipped / SCHEDULER_DEVICE_DUE (the device executes later;
 *   the Worker never touches Google);
 * - beyond grace: the reserved missed / SCHEDULER_MISSED representation.
 * Never failed, never no-op, never cancelled — an observation is not an
 * execution and must not masquerade as one.
 */
export function buildSchedulerObservation(input: SchedulerObservationInput): RoutineRunRecord {
  const { routine, occurrence, classification, now, generation, id } = input;
  void generation; // recorded by the caller in its own column: the shared run-record schema stays mirror-clean
  const executionMode = classification.mode === 'catch-up' ? 'catch-up' : 'scheduled';
  if (classification.mode === 'missed') {
    return {
      id,
      runKey: routineRunKey(routine.id, executionMode, occurrence),
      routineId: routine.id,
      routineName: routine.name,
      executionMode,
      scheduledFor: occurrence,
      startedAt: now,
      completedAt: now,
      state: 'missed',
      outcome: 'missed',
      errorCode: SCHEDULER_MISSED_CODE,
    };
  }
  const cloud = deriveExecutionLocus(routine.permissions) === 'cloud';
  return {
    id,
    runKey: routineRunKey(routine.id, executionMode, occurrence),
    routineId: routine.id,
    routineName: routine.name,
    executionMode,
    scheduledFor: occurrence,
    startedAt: now,
    completedAt: now,
    state: 'skipped',
    outcome: 'skipped',
    errorCode: cloud ? SCHEDULER_DRY_RUN_CODE : SCHEDULER_DEVICE_DUE_CODE,
  };
}

/**
 * Rolling-day budget for one routine: how many of its scheduled/catch-up
 * occurrences were ADMITTED (observed as runnable) in the last 24 h. Missed
 * occurrences and overlap refusals are not runs and never consume budget.
 * policy.maxRunsPerDay is the scheduler-owned budget — manual Run now is not
 * counted (it is counted nowhere in the cloud).
 */
export function schedulerBudgetUsed(runs: readonly Pick<RoutineRunRecord, 'executionMode' | 'state' | 'outcome' | 'errorCode' | 'startedAt'>[], now: number): number {
  const windowStart = now - 24 * 3_600_000;
  return runs.filter((run) =>
    (run.executionMode === 'scheduled' || run.executionMode === 'catch-up')
    && run.startedAt >= windowStart
    && run.state !== 'missed'
    && run.errorCode !== SCHEDULER_OVERLAP_CODE,
  ).length;
}
