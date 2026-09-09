import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  ELARA_AUTH_TIMESTAMP_WINDOW_MS,
  ELARA_INTERNAL_HEADER,
  deriveInstallationId,
  internalWakeMarker,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';
import { AUTONOMY_CONTEXT_STALE_MS, validateAutonomyContextPack } from '../../../src/autonomy/context';
import {
  type ClaimRunRecord,
  RUN_ABANDONED_CODE,
  SCHEDULER_BUDGET_CODE,
  SCHEDULER_OVERLAP_CODE,
  abandonedRunKey,
  buildSchedulerObservation,
  classifyDueOccurrence,
  decideRunClaim,
  nextAlarmTime,
  nextOccurrenceAfterProcessed,
  planScheduleReconciliation,
  schedulerBudgetUsed,
  type SchedulerJournalEntry,
  type SchedulerJournalKind,
} from '../../../src/autonomy/scheduler';
import { deriveExecutionLocus, elaraRoutineSchema, routineRunKey, type AutonomousEvent, type ElaraRoutine, type RoutineRunRecord } from '../../../src/autonomy/contracts';
import { routineRunEnvelopeSchema, runCompleteRequestSchema, type RoutineRunEnvelope } from '../../../src/autonomy/envelope';
import { eventIdForRunKey, workflowInstanceIdForRunKey } from '../../../src/autonomy/workflow-identity';
import { evaluateEventAdmission, noveltyFingerprint } from '../../../src/autonomy/policy';
import type { CloudAdmitResult } from '../../../src/autonomy/cloud-result';
import { AutonomyStore } from './store';
import type { SchedulerPort } from './ports';

// ---------------------------------------------------------------------------
// AutonomyEngine — one Durable Object per installation (idFromName of the
// installationId derived from the ELARA_INSTALLATION_TOKEN). Phase C0: the
// scheduler still owns due-time truth. Cloud-locus dues become a durable
// `running` claim plus a deterministic Workflow identity (hashed runKey).
// Gemini runs in the Workflow, never in this DO. The DO is still not an application runtime.
//
// Wake topology (design §4.1/§10.1): there is NO public wake endpoint. The
// hourly cron reaches this DO only through the Worker→DO binding, carrying an
// internal marker derived from the installation token. App-facing operations
// arrive through the Worker, which forwards the original authenticated
// request; the DO RE-VERIFIES authentication independently (defense in depth
// — it never trusts the forwarder's word).
//
// At-least-once correctness: alarm retries, duplicate heartbeats, repeated
// config syncs, and DO restarts all converge through runKey idempotency —
// one canonical record per (routine, occurrence, mode).
// ---------------------------------------------------------------------------

export interface AutonomyEnv {
  ELARA_INSTALLATION_TOKEN?: string;
  GEMINI_API_KEY?: string;
  C1_MODEL_STUB?: string;
  ROUTINE_RUN?: Workflow<RoutineRunEnvelope>;
}

const configSyncSchema = z.strictObject({
  generation: z.number().int().min(0),
  enabled: z.boolean(),
  maxEventsPerDay: z.number().int().min(1).max(30),
  routines: z.array(elaraRoutineSchema).max(12),
});

const ensureScheduledSchema = z.strictObject({ routineId: z.string().min(1).max(128), dueAt: z.number().finite() });
const cancelSchema = z.strictObject({ routineId: z.string().min(1).max(128) });

type AuthOutcome = { ok: true; installationId: string } | { ok: false; status: number; code: string; message: string };

/** Internal route result: status + JSON body (never a 200 with an error code inside). */
type RouteResult = { status: number; body: Record<string, unknown> };

function jsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export class AutonomyEngine extends DurableObject {
  protected readonly store: AutonomyStore;
  protected readonly autonomyEnv: AutonomyEnv;

  constructor(ctx: DurableObjectState, env: AutonomyEnv) {
    super(ctx, env as unknown as Record<string, unknown>);
    this.autonomyEnv = env;
    this.store = new AutonomyStore(ctx.storage.sql, (closure) => ctx.storage.transactionSync(closure));
    this.store.ensureSchema();
  }

  // ------------------------------------------------------------------- auth

  private async verifyRead(request: Request): Promise<AuthOutcome> {
    const token = this.autonomyEnv.ELARA_INSTALLATION_TOKEN ?? null;
    if (!token) return { ok: false, status: 503, code: 'configuration', message: 'Autonomy is not configured on this worker (missing installation token).' };
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    if (!(await verifyBearerToken(bearer, token))) return { ok: false, status: 401, code: 'auth', message: 'A valid installation token is required.' };
    return { ok: true, installationId: await deriveInstallationId(token) };
  }

  /**
   * Full write verification: bearer possession, HMAC signature over
   * method+path+timestamp+body, timestamp window, and the nonce ledger
   * (strict replay rejection — the ledger is durable and local to this DO).
   */
  private async verifyWrite(request: Request, path: string, body: string): Promise<AuthOutcome> {
    const token = this.autonomyEnv.ELARA_INSTALLATION_TOKEN ?? null;
    if (!token) return { ok: false, status: 503, code: 'configuration', message: 'Autonomy is not configured on this worker (missing installation token).' };
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    if (!(await verifyBearerToken(bearer, token))) return { ok: false, status: 401, code: 'auth', message: 'A valid installation token is required.' };
    const timestamp = request.headers.get(ELARA_AUTH_TIMESTAMP_HEADER) ?? '';
    const signature = request.headers.get(ELARA_AUTH_SIGNATURE_HEADER) ?? '';
    const nonce = request.headers.get(ELARA_AUTH_NONCE_HEADER) ?? '';
    const verified = await verifySignedWrite({ method: request.method, path, timestamp, signature, body }, token, Date.now());
    if (!verified.ok || !verified.installationId) {
      const status = verified.code === 'stale-timestamp' ? 409 : 401;
      return { ok: false, status, code: verified.code ?? 'bad-signature', message: `Write rejected: ${verified.code ?? 'bad-signature'}.` };
    }
    if (!nonce) return { ok: false, status: 401, code: 'auth', message: 'Signed writes require a nonce.' };
    if (!this.store.recordNonce(nonce, Date.now(), ELARA_AUTH_TIMESTAMP_WINDOW_MS * 2)) {
      return { ok: false, status: 409, code: 'replayed-nonce', message: 'Replayed request.' };
    }
    return { ok: true, installationId: verified.installationId };
  }

  /** Maintenance paths (cron heartbeat, port operations) are binding-internal only. */
  private async verifyInternal(request: Request): Promise<boolean> {
    const token = this.autonomyEnv.ELARA_INSTALLATION_TOKEN ?? null;
    if (!token) return false;
    return request.headers.get(ELARA_INTERNAL_HEADER) === (await internalWakeMarker(token));
  }

  // -------------------------------------------------------------- DO routes

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // App-facing routes: the Worker forwards the ORIGINAL public path so the
      // HMAC signature (method + public path + timestamp + body) verifies
      // verbatim. Re-verified here — the DO never trusts the forwarder.
      if (request.method === 'POST' && path === '/autonomy/config') {
        const body = await request.text();
        const auth = await this.verifyWrite(request, path, body);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        const result = await this.syncConfig(body, Date.now());
        return this.json(result.body, result.status);
      }
      if (request.method === 'POST' && path === '/autonomy/context') {
        const body = await request.text();
        const auth = await this.verifyWrite(request, path, body);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        const payload = jsonSafe(body) as { clear?: unknown } | null;
        const result: RouteResult = payload?.clear === true ? this.clearContext(Date.now()) : await this.replaceContext(body, Date.now());
        return this.json(result.body, result.status);
      }
      if (request.method === 'GET' && path === '/autonomy/state') {
        const auth = await this.verifyRead(request);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        return this.json(await this.state(Date.now()));
      }
      if (request.method === 'GET' && path === '/autonomy/runs') {
        const auth = await this.verifyRead(request);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        const since = Number(url.searchParams.get('since') ?? '0');
        return this.json({ runs: this.store.listRunsSince(Number.isFinite(since) ? since : 0) });
      }
      if (request.method === 'GET' && path === '/autonomy/events') {
        const auth = await this.verifyRead(request);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        const since = Number(url.searchParams.get('since') ?? '0');
        return this.json({ events: this.store.listEventsSince(Number.isFinite(since) ? since : 0) });
      }
      if (request.method === 'GET' && path === '/autonomy/context') {
        const auth = await this.verifyRead(request);
        if (!auth.ok) return Response.json({ code: auth.code, message: auth.message }, { status: auth.status });
        return this.json({ context: this.contextSummary(Date.now()) });
      }
      // Internal maintenance: binding-only (cron heartbeat via the Worker's
      // scheduled() handler, SchedulerPort operations). The Worker never
      // forwards public traffic to these paths; the internal marker closes
      // the loop against any future accidental exposure.
      if (request.method === 'POST' && path === '/heartbeat') {
        if (!(await this.verifyInternal(request))) return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
        return this.json(await this.heartbeat(Date.now()));
      }
      // SchedulerPort surface (binding-internal; exercised by contract tests
      // and reserved for Phase C re-anchoring — never publicly routable).
      if (request.method === 'POST' && path === '/scheduler/ensure') {
        if (!(await this.verifyInternal(request))) return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
        const parsed = ensureScheduledSchema.safeParse(jsonSafe(await request.text()));
        if (!parsed.success) return Response.json({ code: 'validation', message: 'Invalid ensureScheduled request.' }, { status: 400 });
        await this.ensureScheduled(parsed.data.routineId, parsed.data.dueAt);
        return this.json({ ok: true });
      }
      if (request.method === 'POST' && path === '/scheduler/cancel') {
        if (!(await this.verifyInternal(request))) return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
        const parsed = cancelSchema.safeParse(jsonSafe(await request.text()));
        if (!parsed.success) return Response.json({ code: 'validation', message: 'Invalid cancel request.' }, { status: 400 });
        await this.cancel(parsed.data.routineId);
        return this.json({ ok: true });
      }
      if (request.method === 'GET' && path === '/scheduler/due') {
        if (!(await this.verifyInternal(request))) return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
        const from = Number(url.searchParams.get('from') ?? '0');
        const to = Number(url.searchParams.get('to') ?? '0');
        return this.json({ due: await this.dueWithin(from, to) });
      }
      if (request.method === 'POST' && path === '/run/complete') {
        if (!(await this.verifyInternal(request))) return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
        const result = await this.completeClaim(jsonSafe(await request.text()), Date.now());
        return this.json(result.body, result.status);
      }
      return Response.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
    } catch (error) {
      // Structured, never swallowed: the journal records the failure and the
      // caller sees a 500 with a code — never a silent success.
      this.journal(Date.now(), 'error', { generation: this.store.getMetaNumber('stateGeneration', 0), detail: `DO route failed: ${error instanceof Error ? error.message : 'unknown error'}` });
      return Response.json({ code: 'internal', message: 'The autonomy engine could not complete the request.' }, { status: 500 });
    }
  }

  private json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  // ----------------------------------------------------------- SchedulerPort

  /** Idempotent registration by natural key (routineId). */
  async ensureScheduled(routineId: string, dueAt: number): Promise<void> {
    this.store.upsertSchedule(routineId, dueAt, Date.now());
    await this.armAlarm();
  }

  /** Idempotent cancellation. */
  async cancel(routineId: string): Promise<void> {
    this.store.cancelSchedule(routineId);
    await this.armAlarm();
  }

  async dueWithin(fromMs: number, toMs: number): Promise<Array<{ routineId: string; dueAt: number }>> {
    return this.store
      .listSchedules()
      .filter((entry) => entry.dueAt >= fromMs && entry.dueAt <= toMs)
      .map((entry) => ({ routineId: entry.routineId, dueAt: entry.dueAt }));
  }

  /** Arm the ONE alarm at the earliest due entry (the multiplexer's whole job). */
  private async armAlarm(): Promise<void> {
    const next = nextAlarmTime(this.store.listSchedules());
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  // ------------------------------------------------------------------ alarm

  /**
   * The DO's single alarm. At-least-once by platform contract: retries after
   * a failure deliver the SAME alarm again — a retry (alarmInfo.isRetry) is
   * NEVER a fresh occurrence; runKey idempotency absorbs the redelivery.
   */
  async alarm(alarmInfo?: DurableObjectAlarmInfo): Promise<void> {
    const now = Date.now();
    this.journal(now, alarmInfo?.isRetry ? 'alarm-retry' : 'alarm', { generation: this.stateGeneration(), detail: alarmInfo?.isRetry ? `retry #${alarmInfo.retryCount}` : undefined });
    try {
      await this.recoverInFlight(now);
      await this.processDue(now);
    } finally {
      // Re-arm unconditionally: even a processing failure must not leave the
      // multiplexer without its alarm (the next heartbeat would still repair,
      // but the alarm is the exact-firing mechanism — it must survive).
      await this.armAlarm();
    }
  }

  // -------------------------------------------------------------- heartbeat

  /**
   * The cron heartbeat / repair sweep: re-reconcile the mirror against the
   * schedules table, process anything due (deploy gaps, missed alarms,
   * control-plane failures), re-arm. Safe to deliver any number of times.
   */
  async heartbeat(now: number): Promise<{ processed: number; nextAlarmAt: number | null; lastHeartbeatAt: number }> {
    this.journal(now, 'heartbeat', { generation: this.stateGeneration() });
    this.store.setMeta('lastHeartbeatAt', String(now));
    this.reconcile(now);
    await this.recoverInFlight(now);
    const processed = await this.processDue(now);
    await this.armAlarm();
    return { processed, nextAlarmAt: nextAlarmTime(this.store.listSchedules()), lastHeartbeatAt: now };
  }

  // ------------------------------------------------------------- config sync

  private async syncConfig(rawBody: string, now: number): Promise<RouteResult> {
    const parsed = configSyncSchema.safeParse(jsonSafe(rawBody));
    if (!parsed.success) {
      return { status: 400, body: {
        code: 'validation',
        message: 'Configuration did not satisfy the autonomy contract.',
        issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.length ? issue.path.join('.') : 'routine'}: ${issue.message}`),
      } };
    }
    const payload = parsed.data;

    // Stale-config protection: an OLDER configuration can never overwrite a
    // newer one, no matter the network arrival order.
    const currentGeneration = this.store.getMetaNumber('configGeneration', 0);
    if (payload.generation < currentGeneration) {
      return { status: 409, body: { code: 'stale-config', message: `Rejected configuration generation ${payload.generation} (current ${currentGeneration}).`, generation: currentGeneration } };
    }

    const incoming = new Set(payload.routines.map((routine) => routine.id));
    for (const routine of payload.routines) this.store.putRoutine(routine);
    for (const existing of this.store.listRoutines()) if (!incoming.has(existing.id)) this.store.deleteRoutine(existing.id);

    this.store.setMeta('configGeneration', String(payload.generation));
    this.store.setMeta('autonomyEnabled', String(payload.enabled));
    this.store.setMeta('maxEventsPerDay', String(payload.maxEventsPerDay));
    this.store.setMeta('lastSyncedAt', String(now));
    this.store.setMeta('stateGeneration', String(this.store.getMetaNumber('stateGeneration', 0) + 1));
    const generation = this.stateGeneration();
    this.journal(now, 'config-sync', { generation, detail: `config generation ${payload.generation}, ${payload.routines.length} routine(s), ${payload.enabled ? 'enabled' : 'disabled'}` });

    this.reconcile(now);
    await this.recoverInFlight(now);
    const processed = await this.processDue(now);
    await this.armAlarm();
    return { status: 200, body: { accepted: true, generation: payload.generation, stateGeneration: generation, processed, nextAlarmAt: nextAlarmTime(this.store.listSchedules()) } };
  }

  // ---------------------------------------------------------------- context

  private async replaceContext(rawBody: string, now: number): Promise<RouteResult> {
    // The worker NEVER trusts the browser's own builder: the pack is
    // re-validated here with the SAME shared schemas (shape, kinds, count,
    // byte size, reconstructible content hash). Malformed/oversized fail closed.
    const validated = await validateAutonomyContextPack(jsonSafe(rawBody));
    if (!validated.ok) return { status: 422, body: { code: 'context-invalid', message: `Autonomy Context rejected: ${validated.code}.` } };
    const stateGeneration = this.store.getMetaNumber('stateGeneration', 0) + 1;
    this.store.replaceContext({
      contentHash: validated.pack.contentHash,
      syncedAt: now,
      generation: stateGeneration,
      recordCount: validated.pack.records.length,
      byteSize: validated.byteSize,
      // Stored as read-only input for Phase C runs. Never logged, never
      // echoed back (hash/metadata only), never included in push payloads.
      records: JSON.stringify(validated.pack.records),
    });
    this.store.setMeta('stateGeneration', String(stateGeneration));
    this.journal(now, 'context-sync', { generation: stateGeneration, detail: `${validated.pack.records.length} record(s), ${validated.byteSize} B` });
    return { status: 200, body: { accepted: true, metadata: this.contextSummary(now) } };
  }

  private clearContext(now: number): RouteResult {
    this.store.clearContext();
    const stateGeneration = this.store.getMetaNumber('stateGeneration', 0) + 1;
    this.store.setMeta('stateGeneration', String(stateGeneration));
    this.journal(now, 'context-clear', { generation: stateGeneration });
    return { status: 200, body: { accepted: true, metadata: this.contextSummary(now) } };
  }

  private contextSummary(now: number): { syncedAt: number; generation: number; recordCount: number; byteSize: number; contentHash: string; stale: boolean } | null {
    const metadata = this.store.contextMetadata();
    if (!metadata) return null;
    return { ...metadata, stale: now - metadata.syncedAt > AUTONOMY_CONTEXT_STALE_MS };
  }

  // ---------------------------------------------------------- scheduling core

  protected stateGeneration(): number {
    return this.store.getMetaNumber('stateGeneration', 0);
  }

  protected journal(at: number, kind: SchedulerJournalKind, entry: Omit<SchedulerJournalEntry, 'at' | 'kind'>): void {
    this.store.appendJournal({ at, kind, ...entry });
  }

  /**
   * Deterministic reconciliation of the schedules table against the mirror:
   * register enabled routines, cancel disabled/deleted ones, repair orphaned
   * rows. Idempotent under repeated delivery by natural key (routineId).
   */
  private reconcile(now: number): void {
    const masterEnabled = this.store.getMetaBoolean('autonomyEnabled', false);
    const current = this.store.listSchedules().map((entry) => ({ routineId: entry.routineId, dueAt: entry.dueAt }));
    const plan = planScheduleReconciliation(this.store.listRoutines(), current, now, masterEnabled);
    const generation = this.stateGeneration();
    const currentByRoutine = new Map(current.map((entry) => [entry.routineId, entry.dueAt]));
    for (const upsert of plan.upserts) {
      this.store.upsertSchedule(upsert.routineId, upsert.dueAt, now);
      const wasScheduled = currentByRoutine.has(upsert.routineId);
      this.journal(now, wasScheduled ? 'rescheduled' : 'registered', { generation, routineId: upsert.routineId, occurrence: upsert.dueAt });
    }
    for (const routineId of plan.cancels) {
      this.store.cancelSchedule(routineId);
      this.journal(now, 'cancelled', { generation, routineId });
    }
    for (const routineId of plan.repairs) {
      this.journal(now, 'repaired', { generation, routineId, detail: 'schedule removed for disabled/missing routine' });
    }
  }

  /**
   * Process every due schedule entry. Cloud locus: two-stage claim
   * (persist running + frozen envelope, then Workflow create/get, then
   * advance). Device locus stays SCHEDULER_DEVICE_DUE. Missed stays a
   * terminal observation. Overlap on a unique runKey is journaled without
   * a second insert.
   */
  private async processDue(now: number): Promise<number> {
    const generation = this.stateGeneration();
    const due = this.store.listSchedules().filter((entry) => entry.dueAt <= now);
    let processed = 0;
    for (const entry of due) {
      const routine = this.store.getRoutine(entry.routineId);
      if (!routine) {
        this.store.cancelSchedule(entry.routineId);
        this.journal(now, 'routine-missing', { generation, routineId: entry.routineId, occurrence: entry.dueAt });
        continue;
      }
      if (!routine.enabled || !this.store.getMetaBoolean('autonomyEnabled', false)) {
        this.store.cancelSchedule(entry.routineId);
        this.journal(now, 'routine-disabled', { generation, routineId: routine.id, occurrence: entry.dueAt });
        continue;
      }

      const classification = classifyDueOccurrence(routine.schedule, routine.timezone, entry.dueAt, now);
      const executionMode = classification.mode === 'catch-up' ? 'catch-up' : 'scheduled';
      const runKey = routineRunKey(routine.id, executionMode, entry.dueAt);
      const locus = deriveExecutionLocus(routine.permissions);
      const decision = decideRunClaim(this.store.listRunsForRoutine(routine.id).map((stored) => stored.record), runKey, routine.id, now);

      if (decision.action === 'already-executed') {
        this.journal(now, 'already-executed', { generation, routineId: routine.id, occurrence: entry.dueAt });
        this.advanceSchedule(routine, now, generation, entry.dueAt);
      } else if (decision.action === 'in-flight') {
        this.journal(now, 'overlap-prevented', { generation, routineId: routine.id, occurrence: entry.dueAt });
        await this.progressClaim(runKey, now, generation, 'recover');
      } else {
        if (decision.abandoned) {
          this.abandonRun(decision.abandoned, now, generation, locus);
        }
        const budgetUsed = schedulerBudgetUsed(this.store.listRunsForRoutine(routine.id).map((stored) => stored.record), now);
        if (budgetUsed >= routine.policy.maxRunsPerDay) {
          this.store.insertRun({
            id: `run-${crypto.randomUUID()}`,
            runKey,
            routineId: routine.id,
            routineName: routine.name,
            executionMode,
            scheduledFor: entry.dueAt,
            startedAt: now,
            completedAt: now,
            state: 'skipped',
            outcome: 'skipped',
            errorCode: SCHEDULER_BUDGET_CODE,
          }, generation, locus);
          this.journal(now, 'budget-exceeded', { generation, routineId: routine.id, occurrence: entry.dueAt, detail: `${budgetUsed} of ${routine.policy.maxRunsPerDay} scheduled runs used` });
          this.advanceSchedule(routine, now, generation, entry.dueAt);
        } else if (classification.mode === 'missed') {
          const observation = buildSchedulerObservation({ routine, occurrence: entry.dueAt, classification, now, generation, id: `run-${crypto.randomUUID()}` });
          this.store.insertRun(observation, generation, locus);
          this.journal(now, 'missed', { generation, routineId: routine.id, occurrence: entry.dueAt });
          this.advanceSchedule(routine, now, generation, entry.dueAt);
        } else if (locus === 'device') {
          const observation = buildSchedulerObservation({ routine, occurrence: entry.dueAt, classification, now, generation, id: `run-${crypto.randomUUID()}` });
          this.store.insertRun(observation, generation, locus);
          this.journal(now, 'device-due', { generation, routineId: routine.id, occurrence: entry.dueAt });
          this.advanceSchedule(routine, now, generation, entry.dueAt);
        } else {
          const runId = `run-${crypto.randomUUID()}`;
          const envelope = await this.freezeEnvelope({ routine, runKey, runId, executionMode, occurrence: entry.dueAt, now, generation });
          this.store.claimCloudRun({
            id: runId,
            runKey,
            routineId: routine.id,
            routineName: routine.name,
            executionMode,
            scheduledFor: entry.dueAt,
            startedAt: now,
            state: 'running',
          }, envelope, generation);
          this.journal(now, 'claimed', { generation, routineId: routine.id, occurrence: entry.dueAt, detail: envelope.workflowInstanceId });
          await this.progressClaim(runKey, now, generation, 'fresh');
        }
      }
      processed += 1;
    }
    if (processed > 0) this.store.pruneRuns(now);
    return processed;
  }

  protected async freezeEnvelope(input: { routine: ElaraRoutine; runKey: string; runId: string; executionMode: 'scheduled' | 'catch-up'; occurrence: number; now: number; generation: number }): Promise<RoutineRunEnvelope> {
    const metadata = this.store.contextMetadata();
    const rawRecords = this.store.contextRecords();
    const context = metadata && rawRecords
      ? { contentHash: metadata.contentHash, syncedAt: metadata.syncedAt, records: JSON.parse(rawRecords) as unknown[] }
      : null;
    return routineRunEnvelopeSchema.parse({
      version: 1,
      runKey: input.runKey,
      runId: input.runId,
      workflowInstanceId: await workflowInstanceIdForRunKey(input.runKey),
      routineId: input.routine.id,
      executionMode: input.executionMode,
      scheduledFor: input.occurrence,
      claimedAt: input.now,
      configGeneration: this.store.getMetaNumber('configGeneration', 0),
      stateGeneration: input.generation,
      routine: input.routine,
      context,
    });
  }

  /**
   * Stage 2: create the Workflow. create() throwing is not success unless
   * get(id) then proves the instance exists (duplicate id, or crash after
   * create). get() proves instance identity/existence, not liveness or health.
   * Any other failure is dispatch-failed and retried by heartbeat.
   *
   * Envelope generations (configGeneration, stateGeneration) are frozen
   * snapshots of the claim. Mid-run generation checks are Phase C2.
   */
  private async dispatchWorkflow(envelope: RoutineRunEnvelope, now: number, generation: number): Promise<boolean> {
    const binding = this.autonomyEnv.ROUTINE_RUN;
    if (!binding) {
      this.journal(now, 'dispatch-failed', { generation, routineId: envelope.routineId, occurrence: envelope.scheduledFor, detail: 'ROUTINE_RUN binding is missing' });
      return false;
    }
    try {
      try {
        await binding.create({ id: envelope.workflowInstanceId, params: envelope });
      } catch (error) {
        const exists = await this.tryGetWorkflow(binding, envelope.workflowInstanceId);
        if (!exists) {
          this.journal(now, 'dispatch-failed', { generation, routineId: envelope.routineId, occurrence: envelope.scheduledFor, detail: error instanceof Error ? error.message : 'workflow create failed' });
          return false;
        }
      }
      this.store.markEnvelopeDispatched(envelope.runKey);
      this.journal(now, 'dispatched', { generation, routineId: envelope.routineId, occurrence: envelope.scheduledFor, detail: envelope.workflowInstanceId });
      return true;
    } catch (error) {
      this.journal(now, 'dispatch-failed', { generation, routineId: envelope.routineId, occurrence: envelope.scheduledFor, detail: error instanceof Error ? error.message : 'workflow create failed' });
      return false;
    }
  }

  private async tryGetWorkflow(binding: Workflow<RoutineRunEnvelope>, id: string): Promise<boolean> {
    try {
      await binding.get(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * CLAIMED + envelope + !dispatched → retry create
   * DISPATCHED + !scheduleAdvanced → advance schedule
   * DISPATCHED + advanced → wait for Workflow
   * running without envelope → journaled error (forbidden after atomic claim)
   */
  private async progressClaim(runKey: string, now: number, generation: number, source: 'fresh' | 'recover'): Promise<void> {
    const stored = this.store.getStoredRun(runKey);
    if (!stored || (stored.record.state !== 'pending' && stored.record.state !== 'running')) return;
    const envelopeRow = this.store.getEnvelope(runKey);
    if (!envelopeRow) {
      this.journal(now, 'error', { generation, routineId: stored.record.routineId, occurrence: stored.record.scheduledFor, detail: `running claim ${runKey} has no envelope` });
      return;
    }
    if (!envelopeRow.dispatched) {
      if (source === 'recover') {
        this.journal(now, 'recovered', { generation, routineId: stored.record.routineId, occurrence: stored.record.scheduledFor, detail: envelopeRow.envelope.workflowInstanceId });
      }
      const ok = await this.dispatchWorkflow(envelopeRow.envelope, now, generation);
      if (!ok) return;
    }
    const routine = this.store.getRoutine(stored.record.routineId);
    if (routine) this.advanceScheduleIfNeeded(runKey, routine, now, generation, stored.record.scheduledFor);
  }

  private async recoverInFlight(now: number): Promise<void> {
    const generation = this.stateGeneration();
    for (const stored of this.store.listRunningCloud()) {
      await this.progressClaim(stored.record.runKey, now, generation, 'recover');
    }
  }

  private advanceScheduleIfNeeded(runKey: string, routine: ElaraRoutine, now: number, generation: number, occurrence: number): void {
    const row = this.store.getEnvelope(runKey);
    if (row?.scheduleAdvanced) return;
    this.advanceSchedule(routine, now, generation, occurrence, runKey);
  }

  private advanceSchedule(routine: ElaraRoutine, now: number, generation: number, occurrence: number, runKey: string | null = null): void {
    try {
      const next = nextOccurrenceAfterProcessed(routine, occurrence);
      this.store.commitScheduleAdvance(routine.id, next, now, runKey);
    } catch (error) {
      this.store.cancelSchedule(routine.id);
      this.journal(now, 'error', { generation, routineId: routine.id, occurrence, detail: `next-occurrence computation failed: ${error instanceof Error ? error.message : 'unknown'}` });
    }
  }

  /**
   * Idempotent completion from the Workflow. Snapshot-and-finish: master-off,
   * routine disable, or delete blocks event admission and records
   * cancelled-admission. Completing twice is a no-op.
   */
  async completeClaim(raw: unknown, now: number): Promise<RouteResult> {
    const parsed = runCompleteRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: 400, body: { code: 'validation', message: 'Invalid run completion request.' } };
    const { runKey, workflowInstanceId } = parsed.data;
    const stored = this.store.getStoredRun(runKey);
    if (!stored) return { status: 404, body: { status: 'claim-not-found', code: 'claim-not-found', message: 'No claim exists for this runKey.' } };
    const expectedId = await workflowInstanceIdForRunKey(runKey);
    if (expectedId !== workflowInstanceId) {
      return { status: 409, body: { status: 'identity-mismatch', code: 'identity-mismatch', message: 'Workflow instance id does not match the runKey identity.' } };
    }
    if (stored.record.state === 'completed' || stored.record.state === 'failed' || stored.record.state === 'skipped' || stored.record.state === 'missed') {
      return { status: 200, body: { status: 'already-completed', runKey, alreadyCompleted: true } };
    }
    const envelopeRow = this.store.getEnvelope(runKey);
    if (!envelopeRow) {
      return { status: 500, body: { status: 'retryable-error', code: 'missing-envelope', message: 'Active claim is missing its frozen envelope; retry after recovery.' } };
    }
    if (envelopeRow.envelope.workflowInstanceId !== workflowInstanceId) {
      return { status: 409, body: { status: 'identity-mismatch', code: 'identity-mismatch', message: 'Workflow instance id does not match the frozen envelope.' } };
    }
    const result = parsed.data.result;
    if (!result) {
      return { status: 500, body: { status: 'retryable-error', code: 'missing-result', message: 'Active claim completion requires a structured C1 result.' } };
    }
    const liveRoutine = this.store.getRoutine(stored.record.routineId);
    const masterOn = this.store.getMetaBoolean('autonomyEnabled', false);
    const cancelled = !masterOn || !liveRoutine || !liveRoutine.enabled;
    const generation = this.stateGeneration();
    const frozen = envelopeRow.envelope.routine;
    if (cancelled) {
      const record: RoutineRunRecord = {
        ...stored.record,
        completedAt: now,
        state: 'failed',
        outcome: 'error',
        errorCode: 'cancelled-admission',
        errorMessage: 'Live gate closed before events could be admitted.',
      };
      this.store.admitCompletedRun(runKey, record, generation, stored.locus, null);
      this.journal(now, 'cancelled-admission', { generation, routineId: stored.record.routineId, occurrence: stored.record.scheduledFor, detail: runKey });
      if (liveRoutine) this.advanceScheduleIfNeeded(runKey, liveRoutine, now, generation, stored.record.scheduledFor);
      return { status: 200, body: { status: 'cancelled', runKey, alreadyCompleted: false, cancelled: true } };
    }
    const admitted = await this.admitResult(stored.record, result, frozen, now, generation, stored.locus);
    this.journal(now, admitted.status === 'suppressed' ? 'completed' : admitted.status === 'completed' ? 'completed' : 'completed', {
      generation, routineId: stored.record.routineId, occurrence: stored.record.scheduledFor, detail: runKey,
    });
    this.advanceScheduleIfNeeded(runKey, liveRoutine, now, generation, stored.record.scheduledFor);
    return { status: 200, body: { status: admitted.status, runKey, alreadyCompleted: false, cancelled: false } };
  }

  private async admitResult(
    stored: RoutineRunRecord,
    result: CloudAdmitResult,
    frozen: ElaraRoutine,
    now: number,
    generation: number,
    locus: 'cloud' | 'device',
  ): Promise<{ status: 'completed' | 'suppressed' | 'failed' }> {
    if (result.disposition === 'error') {
      this.store.admitCompletedRun(stored.runKey, {
        ...stored, completedAt: now, state: 'failed', outcome: 'error', errorCode: result.errorCode, errorMessage: result.errorMessage,
      }, generation, locus, null);
      return { status: 'failed' };
    }
    if (result.disposition === 'noop' || result.disposition === 'cannot_act') {
      this.store.admitCompletedRun(stored.runKey, {
        ...stored,
        completedAt: now,
        state: 'completed',
        outcome: 'no-op',
        reason: result.reason,
        itemsExamined: result.disposition === 'noop' ? result.itemsExamined : undefined,
      }, generation, locus, null);
      return { status: 'completed' };
    }
    const fingerprint = noveltyFingerprint(frozen.id, result.title, result.summary);
    const recent = this.store.listRecentEvents(now - 7 * 24 * 3_600_000);
    const admission = evaluateEventAdmission({
      routineId: frozen.id,
      fingerprint,
      recentEvents: recent,
      policy: frozen.policy,
      maxEventsPerDay: this.store.getMetaNumber('maxEventsPerDay', 10),
      now,
    });
    if (!admission.admitted) {
      this.store.admitCompletedRun(stored.runKey, {
        ...stored,
        completedAt: now,
        state: 'completed',
        outcome: 'suppressed',
        suppressedReason: admission.reason,
        reason: admission.detail,
      }, generation, locus, null);
      return { status: 'suppressed' };
    }
    const event: AutonomousEvent = {
      id: await eventIdForRunKey(stored.runKey),
      routineId: frozen.id,
      runKey: stored.runKey,
      title: result.title,
      summary: result.summary,
      importance: result.importance,
      confidence: result.confidence,
      evidence: result.evidence ?? [],
      noveltyFingerprint: fingerprint,
      createdAt: now,
      readAt: null,
    };
    const written = this.store.admitCompletedRun(stored.runKey, {
      ...stored,
      completedAt: now,
      state: 'completed',
      outcome: 'event',
      eventId: event.id,
      itemsExamined: result.itemsExamined,
    }, generation, locus, event);
    if (written === 'duplicate') {
      return { status: 'completed' };
    }
    return { status: 'completed' };
  }

  /** Tombstone a crashed in-flight run: same id, freed occurrence key, terminal failed state. */
  private abandonRun(crashed: ClaimRunRecord, now: number, generation: number, locus: 'cloud' | 'device'): void {
    const existing = this.store.listRunsForRoutine(crashed.routineId).find((stored) => stored.record.id === crashed.id);
    if (!existing) return;
    this.store.replaceRun(existing.record.runKey, {
      ...existing.record,
      runKey: abandonedRunKey(crashed),
      state: 'failed',
      outcome: 'error',
      errorCode: RUN_ABANDONED_CODE,
      errorMessage: 'The run did not finish before the scheduler restarted it.',
      completedAt: now,
    }, generation, locus);
  }

  // ------------------------------------------------------------------ state

  private async state(now: number): Promise<Record<string, unknown>> {
    const routines = this.store.listRoutines();
    const schedules = new Map(this.store.listSchedules().map((entry) => [entry.routineId, entry.dueAt]));
    const alarm = await this.ctx.storage.getAlarm();
    return {
      paired: true,
      schedulerLive: true,
      agentExecution: true,
      dryRun: false,
      generation: this.store.getMetaNumber('configGeneration', 0),
      stateGeneration: this.stateGeneration(),
      autonomyEnabled: this.store.getMetaBoolean('autonomyEnabled', false),
      maxEventsPerDay: this.store.getMetaNumber('maxEventsPerDay', 10),
      lastHeartbeatAt: this.store.getMetaNumber('lastHeartbeatAt', 0) || null,
      lastSyncedAt: this.store.getMetaNumber('lastSyncedAt', 0) || null,
      nextAlarmAt: alarm === null ? null : alarm,
      routines: routines.map((routine: ElaraRoutine) => ({
        id: routine.id,
        name: routine.name,
        enabled: routine.enabled,
        locus: deriveExecutionLocus(routine.permissions),
        schedule: routine.schedule,
        timezone: routine.timezone,
        nextDueAt: schedules.get(routine.id) ?? null,
      })),
      context: this.contextSummary(now),
      journal: this.store.listJournal(20),
    };
  }
}
