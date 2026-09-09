import {
  CLOUD_EVENT_RETENTION_COUNT,
  CLOUD_EVENT_RETENTION_MS,
  CLOUD_RUN_RETENTION_COUNT,
  CLOUD_RUN_RETENTION_MS,
  SCHEDULER_JOURNAL_MAX,
  type SchedulerJournalEntry,
} from '../../../src/autonomy/scheduler';
import { normalizeRoutine, type AutonomousEvent, type ElaraRoutine, type RoutineRunRecord } from '../../../src/autonomy/contracts';
import type { RoutineRunEnvelope } from '../../../src/autonomy/envelope';

// ---------------------------------------------------------------------------
// Durable Object storage — one SQLite-backed AutonomyEngine per installation.
//
// The tables are the DO's private, disposable mirror: the app remains the
// source of truth for routines; deleting the worker deployment destroys only
// this state. Schema initialization is idempotent (CREATE IF NOT EXISTS) and
// versioned via meta.schemaVersion so a fresh install starts cleanly and a
// future schema change is an explicit, reviewable migration.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '3';

export interface StoredSchedule {
  routineId: string;
  dueAt: number;
  updatedAt: number;
}

export interface StoredRun {
  record: RoutineRunRecord;
  generation: number;
  locus: 'cloud' | 'device';
}

export interface StoredContextPack {
  contentHash: string;
  syncedAt: number;
  generation: number;
  recordCount: number;
  byteSize: number;
  records: string;
}

export interface ContextMetadata {
  contentHash: string;
  syncedAt: number;
  generation: number;
  recordCount: number;
  byteSize: number;
}

type MetaKey = 'schemaVersion' | 'configGeneration' | 'stateGeneration' | 'autonomyEnabled' | 'maxEventsPerDay' | 'lastHeartbeatAt' | 'lastSyncedAt';

function isActiveRunState(state: RoutineRunRecord['state']): boolean {
  return state === 'pending' || state === 'running';
}

/** Thin typed layer over DO SQL. Every statement is one exec call. */
export class AutonomyStore {
  constructor(
    private readonly sql: DurableObjectSql,
    private readonly transact: (closure: () => void) => void = (closure) => closure(),
  ) {}

  ensureSchema(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, record TEXT NOT NULL, updatedAt INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS schedules (routineId TEXT PRIMARY KEY, dueAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS schedules_due ON schedules(dueAt)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, runKey TEXT NOT NULL UNIQUE, routineId TEXT NOT NULL, record TEXT NOT NULL, generation INTEGER NOT NULL, locus TEXT NOT NULL, startedAt INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS runs_started ON runs(startedAt)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS runs_routine ON runs(routineId)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, generation INTEGER NOT NULL, routineId TEXT, occurrence INTEGER, detail TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS context (id INTEGER PRIMARY KEY CHECK (id = 1), contentHash TEXT NOT NULL, syncedAt INTEGER NOT NULL, generation INTEGER NOT NULL, recordCount INTEGER NOT NULL, byteSize INTEGER NOT NULL, records TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, seenAt INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS envelopes (runKey TEXT PRIMARY KEY, workflowInstanceId TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, dispatched INTEGER NOT NULL, scheduleAdvanced INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, runKey TEXT NOT NULL UNIQUE, routineId TEXT NOT NULL, record TEXT NOT NULL, createdAt INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_created ON events(createdAt)');
    this.setMeta('schemaVersion', SCHEMA_VERSION);
  }

  // ----- meta -----

  getMeta(key: MetaKey): string | undefined {
    const row = this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return row?.value;
  }

  getMetaNumber(key: MetaKey, fallback: number): number {
    const value = Number(this.getMeta(key));
    return Number.isFinite(value) ? value : fallback;
  }

  getMetaBoolean(key: MetaKey, fallback: boolean): boolean {
    const value = this.getMeta(key);
    return value === undefined ? fallback : value === 'true';
  }

  setMeta(key: MetaKey, value: string): void {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  // ----- routine mirror (disposable; the app is authoritative) -----

  putRoutine(routine: ElaraRoutine): void {
    this.sql.exec('INSERT INTO routines (id, record, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record, updatedAt = excluded.updatedAt', routine.id, JSON.stringify(routine), routine.updatedAt);
  }

  deleteRoutine(id: string): void {
    this.sql.exec('DELETE FROM routines WHERE id = ?', id);
  }

  listRoutines(): ElaraRoutine[] {
    // normalizeRoutine is the shared fail-closed guard: a corrupted mirror row
    // is normalized (disabled on unrecognized schedule), never executed as-is.
    return this.sql.exec<{ record: string }>('SELECT record FROM routines ORDER BY id').toArray().map((row) => normalizeRoutine(JSON.parse(row.record)));
  }

  getRoutine(id: string): ElaraRoutine | undefined {
    const row = this.sql.exec<{ record: string }>('SELECT record FROM routines WHERE id = ?', id).toArray()[0];
    return row ? normalizeRoutine(JSON.parse(row.record)) : undefined;
  }

  // ----- schedules (the single-alarm multiplexer's table) -----

  upsertSchedule(routineId: string, dueAt: number, updatedAt: number): void {
    this.sql.exec('INSERT INTO schedules (routineId, dueAt, updatedAt) VALUES (?, ?, ?) ON CONFLICT(routineId) DO UPDATE SET dueAt = excluded.dueAt, updatedAt = excluded.updatedAt', routineId, dueAt, updatedAt);
  }

  cancelSchedule(routineId: string): void {
    this.sql.exec('DELETE FROM schedules WHERE routineId = ?', routineId);
  }

  listSchedules(): StoredSchedule[] {
    return this.sql.exec<StoredSchedule>('SELECT routineId, dueAt, updatedAt FROM schedules ORDER BY dueAt').toArray();
  }

  // ----- runs (scheduler observation records) -----

  insertRun(record: RoutineRunRecord, generation: number, locus: 'cloud' | 'device'): void {
    this.sql.exec('INSERT INTO runs (id, runKey, routineId, record, generation, locus, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', record.id, record.runKey, record.routineId, JSON.stringify(record), generation, locus, record.startedAt);
  }

  /**
   * Atomic durable claim: the running row and its frozen envelope commit
   * together or not at all. A crash cannot leave `running` without an envelope.
   */
  claimCloudRun(record: RoutineRunRecord, envelope: RoutineRunEnvelope, generation: number): void {
    this.transact(() => {
      this.insertRun(record, generation, 'cloud');
      this.putEnvelope(envelope, false, false);
    });
  }

  /** Rewrite one run row (crash tombstoning): same id, new runKey/state. */
  replaceRun(originalRunKey: string, record: RoutineRunRecord, generation: number, locus: 'cloud' | 'device'): void {
    this.sql.exec('UPDATE runs SET runKey = ?, record = ?, generation = ?, locus = ? WHERE runKey = ?', record.runKey, JSON.stringify(record), generation, locus, originalRunKey);
  }

  /** Terminalize an in-flight run without changing its canonical runKey. */
  updateRunRecord(runKey: string, record: RoutineRunRecord, generation: number, locus: 'cloud' | 'device'): void {
    this.sql.exec('UPDATE runs SET record = ?, generation = ?, locus = ? WHERE runKey = ?', JSON.stringify(record), generation, locus, runKey);
  }

  runExists(runKey: string): boolean {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE runKey = ?', runKey).toArray()[0]!.n > 0;
  }

  getStoredRun(runKey: string): StoredRun | undefined {
    const row = this.sql.exec<{ record: string; generation: number; locus: string }>('SELECT record, generation, locus FROM runs WHERE runKey = ?', runKey).toArray()[0];
    return row ? { record: JSON.parse(row.record) as RoutineRunRecord, generation: row.generation, locus: row.locus as 'cloud' | 'device' } : undefined;
  }

  listRunningCloud(): StoredRun[] {
    return this.sql.exec<{ record: string; generation: number; locus: string }>('SELECT record, generation, locus FROM runs WHERE locus = ? ORDER BY startedAt', 'cloud')
      .toArray()
      .map((row) => ({ record: JSON.parse(row.record) as RoutineRunRecord, generation: row.generation, locus: row.locus as 'cloud' | 'device' }))
      .filter((stored) => stored.record.state === 'pending' || stored.record.state === 'running');
  }

  putEnvelope(envelope: RoutineRunEnvelope, dispatched: boolean, scheduleAdvanced: boolean): void {
    this.sql.exec(
      'INSERT INTO envelopes (runKey, workflowInstanceId, payload, dispatched, scheduleAdvanced) VALUES (?, ?, ?, ?, ?) ON CONFLICT(runKey) DO UPDATE SET workflowInstanceId = excluded.workflowInstanceId, payload = excluded.payload, dispatched = excluded.dispatched, scheduleAdvanced = excluded.scheduleAdvanced',
      envelope.runKey,
      envelope.workflowInstanceId,
      JSON.stringify(envelope),
      dispatched ? 1 : 0,
      scheduleAdvanced ? 1 : 0,
    );
  }

  getEnvelope(runKey: string): { envelope: RoutineRunEnvelope; dispatched: boolean; scheduleAdvanced: boolean } | undefined {
    const row = this.sql.exec<{ payload: string; dispatched: number; scheduleAdvanced: number }>('SELECT payload, dispatched, scheduleAdvanced FROM envelopes WHERE runKey = ?', runKey).toArray()[0];
    return row ? { envelope: JSON.parse(row.payload) as RoutineRunEnvelope, dispatched: row.dispatched === 1, scheduleAdvanced: row.scheduleAdvanced === 1 } : undefined;
  }

  markEnvelopeDispatched(runKey: string): void {
    this.sql.exec('UPDATE envelopes SET dispatched = 1 WHERE runKey = ?', runKey);
  }

  markEnvelopeScheduleAdvanced(runKey: string): void {
    this.sql.exec('UPDATE envelopes SET scheduleAdvanced = 1 WHERE runKey = ?', runKey);
  }

  /**
   * Write the next due instant and the scheduleAdvanced marker together so a
   * crash cannot leave the schedule moved without the marker (or vice versa).
   */
  commitScheduleAdvance(routineId: string, nextDueAt: number, updatedAt: number, runKey: string | null): void {
    this.transact(() => {
      this.upsertSchedule(routineId, nextDueAt, updatedAt);
      if (runKey) this.markEnvelopeScheduleAdvanced(runKey);
    });
  }

  listEnvelopeRunKeys(): string[] {
    return this.sql.exec<{ runKey: string }>('SELECT runKey FROM envelopes').toArray().map((row) => row.runKey);
  }

  deleteEnvelope(runKey: string): void {
    this.sql.exec('DELETE FROM envelopes WHERE runKey = ?', runKey);
  }

  listRunsForRoutine(routineId: string): StoredRun[] {
    return this.sql.exec<{ record: string; generation: number; locus: string }>('SELECT record, generation, locus FROM runs WHERE routineId = ? ORDER BY startedAt', routineId)
      .toArray()
      .map((row) => ({ record: JSON.parse(row.record) as RoutineRunRecord, generation: row.generation, locus: row.locus as 'cloud' | 'device' }));
  }

  listRunsSince(since: number, limit = 200): RoutineRunRecord[] {
    return this.sql.exec<{ record: string }>('SELECT record FROM runs WHERE startedAt > ? ORDER BY startedAt DESC LIMIT ?', since, limit)
      .toArray()
      .map((row) => JSON.parse(row.record) as RoutineRunRecord);
  }

  /**
   * Bounded retention (30 d / 1 000 — the same contract as the local store).
   * Maintenance only: called after the authoritative writes of a processing
   * pass have committed, and never allowed to reject them.
   */
  pruneRuns(now: number): void {
    const cutoff = now - CLOUD_RUN_RETENTION_MS;
    const aged = this.sql.exec<{ id: string; record: string; startedAt: number }>('SELECT id, record, startedAt FROM runs').toArray();
    for (const row of aged) {
      if (row.startedAt < cutoff && !isActiveRunState((JSON.parse(row.record) as RoutineRunRecord).state)) {
        this.sql.exec('DELETE FROM runs WHERE id = ?', row.id);
      }
    }
    const remaining = this.sql.exec<{ id: string; record: string; startedAt: number }>('SELECT id, record, startedAt FROM runs').toArray();
    if (remaining.length > CLOUD_RUN_RETENTION_COUNT) {
      const excess = remaining.length - CLOUD_RUN_RETENTION_COUNT;
      const evict = remaining
        .filter((row) => !isActiveRunState((JSON.parse(row.record) as RoutineRunRecord).state))
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(0, excess);
      for (const row of evict) this.sql.exec('DELETE FROM runs WHERE id = ?', row.id);
    }
    this.pruneEnvelopes();
    this.pruneEvents(now);
  }

  insertEvent(event: AutonomousEvent): boolean {
    try {
      this.sql.exec(
        'INSERT INTO events (id, runKey, routineId, record, createdAt) VALUES (?, ?, ?, ?, ?)',
        event.id,
        event.runKey,
        event.routineId,
        JSON.stringify(event),
        event.createdAt,
      );
      return true;
    } catch {
      return false;
    }
  }

  getEventByRunKey(runKey: string): AutonomousEvent | undefined {
    const row = this.sql.exec<{ record: string }>('SELECT record FROM events WHERE runKey = ?', runKey).toArray()[0];
    return row ? JSON.parse(row.record) as AutonomousEvent : undefined;
  }

  listEventsSince(since: number, limit = 200): AutonomousEvent[] {
    return this.sql.exec<{ record: string }>('SELECT record FROM events WHERE createdAt > ? ORDER BY createdAt DESC LIMIT ?', since, limit)
      .toArray()
      .map((row) => JSON.parse(row.record) as AutonomousEvent);
  }

  listRecentEvents(since: number): AutonomousEvent[] {
    return this.sql.exec<{ record: string }>('SELECT record FROM events WHERE createdAt > ? ORDER BY createdAt DESC', since)
      .toArray()
      .map((row) => JSON.parse(row.record) as AutonomousEvent);
  }

  admitCompletedRun(runKey: string, record: RoutineRunRecord, generation: number, locus: 'cloud' | 'device', event: AutonomousEvent | null): 'admitted' | 'duplicate' {
    let outcome: 'admitted' | 'duplicate' = 'admitted';
    this.transact(() => {
      if (event) {
        if (this.getEventByRunKey(event.runKey)) {
          outcome = 'duplicate';
          return;
        }
        if (!this.insertEvent(event)) {
          outcome = 'duplicate';
          return;
        }
      }
      this.updateRunRecord(runKey, record, generation, locus);
    });
    return outcome;
  }

  pruneEvents(now: number): void {
    const cutoff = now - CLOUD_EVENT_RETENTION_MS;
    this.sql.exec('DELETE FROM events WHERE createdAt < ?', cutoff);
    const remaining = this.sql.exec<{ id: string; createdAt: number }>('SELECT id, createdAt FROM events').toArray();
    if (remaining.length > CLOUD_EVENT_RETENTION_COUNT) {
      const excess = remaining.length - CLOUD_EVENT_RETENTION_COUNT;
      const evict = remaining.sort((a, b) => a.createdAt - b.createdAt).slice(0, excess);
      for (const row of evict) this.sql.exec('DELETE FROM events WHERE id = ?', row.id);
    }
  }

  /**
   * Envelopes follow execution state, not unbounded history:
   * active pending/running claims keep their envelope; terminal or already-
   * pruned runs drop it (Workflow recovery no longer needs the payload).
   */
  pruneEnvelopes(): void {
    for (const runKey of this.listEnvelopeRunKeys()) {
      const stored = this.getStoredRun(runKey);
      if (stored && isActiveRunState(stored.record.state)) continue;
      this.deleteEnvelope(runKey);
    }
  }

  /** Test fixture: rewrite startedAt (retention crash window). */
  setRunStartedAt(runKey: string, startedAt: number): void {
    const stored = this.getStoredRun(runKey);
    if (!stored) return;
    this.sql.exec('UPDATE runs SET record = ?, startedAt = ? WHERE runKey = ?', JSON.stringify({ ...stored.record, startedAt }), startedAt, runKey);
  }

  // ----- journal (bounded scheduler observability) -----

  appendJournal(entry: SchedulerJournalEntry): void {
    this.sql.exec('INSERT INTO journal (at, kind, generation, routineId, occurrence, detail) VALUES (?, ?, ?, ?, ?, ?)', entry.at, entry.kind, entry.generation, entry.routineId ?? null, entry.occurrence ?? null, entry.detail ?? null);
    this.sql.exec(`DELETE FROM journal WHERE seq IN (SELECT seq FROM journal ORDER BY seq DESC LIMIT -1 OFFSET ${SCHEDULER_JOURNAL_MAX})`);
  }

  listJournal(limit = 20): SchedulerJournalEntry[] {
    return this.sql.exec<{ at: number; kind: string; generation: number; routineId: string | null; occurrence: number | null; detail: string | null }>('SELECT at, kind, generation, routineId, occurrence, detail FROM journal ORDER BY seq DESC LIMIT ?', limit)
      .toArray()
      .map((row) => ({
        at: row.at,
        kind: row.kind as SchedulerJournalEntry['kind'],
        generation: row.generation,
        ...(row.routineId !== null ? { routineId: row.routineId } : {}),
        ...(row.occurrence !== null ? { occurrence: row.occurrence } : {}),
        ...(row.detail !== null ? { detail: row.detail } : {}),
      }));
  }

  // ----- Autonomy Context pack (read-only input; never echoed, never logged) -----

  replaceContext(pack: StoredContextPack): void {
    this.sql.exec('INSERT INTO context (id, contentHash, syncedAt, generation, recordCount, byteSize, records) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET contentHash = excluded.contentHash, syncedAt = excluded.syncedAt, generation = excluded.generation, recordCount = excluded.recordCount, byteSize = excluded.byteSize, records = excluded.records', pack.contentHash, pack.syncedAt, pack.generation, pack.recordCount, pack.byteSize, pack.records);
  }

  clearContext(): void {
    this.sql.exec('DELETE FROM context WHERE id = 1');
  }

  contextMetadata(): ContextMetadata | null {
    const row = this.sql.exec<ContextMetadata>('SELECT contentHash, syncedAt, generation, recordCount, byteSize FROM context WHERE id = 1').toArray()[0];
    return row ?? null;
  }

  contextRecords(): string | null {
    return this.sql.exec<{ records: string }>('SELECT records FROM context WHERE id = 1').toArray()[0]?.records ?? null;
  }

  // ----- nonce ledger (strict replay rejection for signed writes) -----

  /**
   * Record a nonce; returns false when it was already seen (replay). Nonces
   * older than the signing window are pruned first — the ledger only needs to
   * remember replays within the ±5-minute acceptance window.
   */
  recordNonce(nonce: string, now: number, windowMs: number): boolean {
    this.sql.exec('DELETE FROM nonces WHERE seenAt < ?', now - windowMs);
    try {
      this.sql.exec('INSERT INTO nonces (nonce, seenAt) VALUES (?, ?)', nonce, now);
      return true;
    } catch {
      return false;
    }
  }
}
