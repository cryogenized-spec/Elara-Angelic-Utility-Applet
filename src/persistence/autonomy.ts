import Dexie, { type Table } from 'dexie';
import {
  MAX_ROUTINES,
  normalizeRoutine,
  type AutonomousEvent,
  type ElaraRoutine,
  type RoutineRunRecord,
} from '../autonomy/contracts';

// ---------------------------------------------------------------------------
// Autonomy persistence — one authoritative local store for routines,
// autonomous events, and run records. Dedicated Dexie database (same
// per-domain pattern as the roleplay world store); the app remains the source
// of truth and any future cloud mirror stays disposable.
//
// Retention (design doc §5/§18-Q10): events 90 days / 500 records,
// runs 30 days / 1 000 records, pruned opportunistically on write.
// ---------------------------------------------------------------------------

export const AUTONOMY_UPDATED_EVENT = 'elara-autonomy-updated';

/** Rolling retention windows applied on every write. */
const EVENT_RETENTION_MS = 90 * 24 * 3_600_000;
const EVENT_RETENTION_COUNT = 500;
const RUN_RETENTION_MS = 30 * 24 * 3_600_000;
const RUN_RETENTION_COUNT = 1_000;

export class RoutineLimitError extends Error {
  readonly code = 'ROUTINE_LIMIT';
  constructor() {
    super(`A maximum of ${MAX_ROUTINES} routines can be configured.`);
  }
}

class AutonomyDatabase extends Dexie {
  routines!: Table<ElaraRoutine, string>;
  events!: Table<AutonomousEvent, string>;
  runs!: Table<RoutineRunRecord, string>;

  constructor() {
    super('elara-autonomy');
    this.version(1).stores({
      routines: 'id, updatedAt, enabled',
      events: 'id, routineId, createdAt, readAt',
      runs: 'id, &runKey, routineId, startedAt, state',
    });
  }
}

const db = new AutonomyDatabase();

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUTONOMY_UPDATED_EVENT));
}

// --------------------------------------------------------------------------- routines

export async function listRoutines(): Promise<ElaraRoutine[]> {
  const records = await db.routines.orderBy('updatedAt').reverse().toArray();
  return records.map((record) => normalizeRoutine(record));
}

export async function getRoutine(id: string): Promise<ElaraRoutine | undefined> {
  const record = await db.routines.get(id);
  return record ? normalizeRoutine(record) : undefined;
}

export async function saveRoutine(routine: ElaraRoutine): Promise<ElaraRoutine> {
  const normalized = normalizeRoutine(routine);
  const existing = await db.routines.get(normalized.id);
  if (!existing && await db.routines.count() >= MAX_ROUTINES) throw new RoutineLimitError();
  await db.routines.put(normalized);
  notify();
  return normalized;
}

export async function deleteRoutine(id: string): Promise<void> {
  await db.routines.delete(id);
  notify();
}

// --------------------------------------------------------------------------- events

export async function listEvents(limit = 100): Promise<AutonomousEvent[]> {
  return db.events.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function recentEvents(sinceMs: number): Promise<AutonomousEvent[]> {
  return db.events.where('createdAt').aboveOrEqual(sinceMs).toArray();
}

export async function addEvent(event: AutonomousEvent): Promise<AutonomousEvent> {
  await db.events.put(event);
  await pruneEvents(event.createdAt);
  notify();
  return event;
}

export async function markEventRead(id: string, readAt = Date.now()): Promise<void> {
  const event = await db.events.get(id);
  if (!event || event.readAt !== null) return;
  await db.events.put({ ...event, readAt });
  notify();
}

export async function markAllEventsRead(readAt = Date.now()): Promise<void> {
  await db.events.filter((event) => event.readAt === null).modify({ readAt });
  notify();
}

export async function countUnreadEvents(): Promise<number> {
  return db.events.filter((event) => event.readAt === null).count();
}

async function pruneEvents(now: number): Promise<void> {
  const cutoff = now - EVENT_RETENTION_MS;
  const stale = await db.events.where('createdAt').below(cutoff).primaryKeys();
  if (stale.length) await db.events.bulkDelete(stale);
  const all = await db.events.orderBy('createdAt').reverse().toArray();
  if (all.length > EVENT_RETENTION_COUNT) {
    await db.events.bulkDelete(all.slice(EVENT_RETENTION_COUNT).map((event) => event.id));
  }
}

// --------------------------------------------------------------------------- runs

export async function listRuns(limit = 50): Promise<RoutineRunRecord[]> {
  return db.runs.orderBy('startedAt').reverse().limit(limit).toArray();
}

export async function listRunsForRoutine(routineId: string, limit = 20): Promise<RoutineRunRecord[]> {
  const runs = await db.runs.where('routineId').equals(routineId).toArray();
  return runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function getRunByRunKey(runKey: string): Promise<RoutineRunRecord | undefined> {
  return db.runs.where('runKey').equals(runKey).first();
}

/** Non-terminal run for a routine, if any (in-flight / overlap guard). */
export async function findRunInFlight(routineId: string): Promise<RoutineRunRecord | undefined> {
  const runs = await db.runs.where('routineId').equals(routineId).toArray();
  return runs.find((run) => run.state === 'pending' || run.state === 'running');
}

/**
 * A 'running'/'pending' run older than this is a crashed run — typically the
 * app/tab closed mid-run. The next claim abandons it (state 'failed',
 * RUN_ABANDONED) instead of letting it block the routine forever. Fifteen
 * minutes comfortably exceeds the worst legitimate run (≤ 20 tool calls
 * bounded by the loop's own budget).
 */
export const STALE_RUN_MS = 15 * 60_000;

export type RunClaimResult =
  | { status: 'claimed'; run: RoutineRunRecord }
  | { status: 'in-flight'; run: RoutineRunRecord }
  | { status: 'already-executed'; run: RoutineRunRecord };

/**
 * Atomically admit ONE run for a routine: the in-flight check, duplicate-runKey
 * check, crash recovery, and insert all happen inside a single IndexedDB
 * transaction, so two concurrent execution contexts can never both observe "no
 * run in flight" and both insert (the read/write race the previous
 * check-then-insert sequence allowed).
 *
 * Check order is deliberate:
 * 1. runKey already exists → 'already-executed' (idempotent redelivery of the
 *    same occurrence — also covers a same-millisecond duplicate manual trigger).
 *    Checked FIRST so the rejected caller can still record its skip without
 *    colliding with the active run's unique runKey.
 * 2. fresh in-flight run exists → 'in-flight' (overlap refused).
 * 3. stale in-flight runs are abandoned (crash recovery), then the run is claimed.
 *
 * The semantics map 1:1 onto a future Durable Object: a DO serializes access
 * per key, so the same claim logic will hold without domain changes.
 */
export async function claimRoutineRun(run: RoutineRunRecord, now = Date.now()): Promise<RunClaimResult> {
  const result = await db.transaction('rw', db.runs, async (): Promise<RunClaimResult> => {
    const existing = await db.runs.where('routineId').equals(run.routineId).toArray();
    const duplicate = existing.find((candidate) => candidate.runKey === run.runKey);
    if (duplicate) return { status: 'already-executed', run: duplicate };
    const inFlight = existing.filter((candidate) => (candidate.state === 'pending' || candidate.state === 'running') && now - candidate.startedAt < STALE_RUN_MS);
    const stale = existing.filter((candidate) => (candidate.state === 'pending' || candidate.state === 'running') && now - candidate.startedAt >= STALE_RUN_MS);
    for (const crashed of stale) {
      // Crash recovery: keep history truthful and unblock the routine. The run
      // record (with its denormalized routine name) survives as the evidence.
      await db.runs.put({
        ...crashed,
        state: 'failed',
        outcome: 'error',
        errorCode: 'RUN_ABANDONED',
        errorMessage: 'The run did not finish (the app closed before completion).',
        completedAt: now,
        durationMs: Math.max(0, now - crashed.startedAt),
      });
    }
    if (inFlight.length) return { status: 'in-flight', run: inFlight[0] };
    await db.runs.put(run);
    return { status: 'claimed', run };
  });
  if (result.status === 'claimed') notify();
  return result;
}

export async function addRun(run: RoutineRunRecord): Promise<RoutineRunRecord> {
  await db.runs.put(run);
  await pruneRuns(run.startedAt);
  notify();
  return run;
}

export async function updateRun(run: RoutineRunRecord): Promise<RoutineRunRecord> {
  await db.runs.put(run);
  notify();
  return run;
}

async function pruneRuns(now: number): Promise<void> {
  const cutoff = now - RUN_RETENTION_MS;
  const stale = await db.runs.where('startedAt').below(cutoff).primaryKeys();
  if (stale.length) await db.runs.bulkDelete(stale);
  const all = await db.runs.orderBy('startedAt').reverse().toArray();
  if (all.length > RUN_RETENTION_COUNT) {
    await db.runs.bulkDelete(all.slice(RUN_RETENTION_COUNT).map((run) => run.id));
  }
}

/** Test/inspection helper: clear the local autonomy store. */
export async function clearAutonomyStore(): Promise<void> {
  await Promise.all([db.routines.clear(), db.events.clear(), db.runs.clear()]);
  notify();
}

export { db as autonomyDb };
