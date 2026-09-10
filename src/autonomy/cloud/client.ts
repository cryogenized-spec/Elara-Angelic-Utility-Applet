import { newNonce, signWrite } from '../protocol';
import type { AutonomyContextPack } from '../context';
import type { ElaraRoutine, RoutineRunRecord } from '../contracts';
import type { AutonomyPairing } from './pairing';

// ---------------------------------------------------------------------------
// App ↔ Worker API client (design §10). Reads carry the bearer token; writes
// are HMAC-SHA256 signed over method+path+timestamp+body with a fresh nonce,
// exactly as the worker (and the DO, independently) verify them.
// ---------------------------------------------------------------------------

export const AUTONOMY_SCHEMA_VERSION = 1;

export interface PairResult {
  installationId: string;
  service: string;
  version: string;
  schemaVersion: number;
  capabilities: string[];
  cron: string;
  schedulerLive?: boolean;
  agentExecution?: boolean;
  dryRun: boolean;
}

export interface ConfigSyncPayload {
  generation: number;
  enabled: boolean;
  maxEventsPerDay: number;
  routines: ElaraRoutine[];
}

export interface CloudContextMetadata {
  contentHash: string;
  syncedAt: number;
  generation: number;
  recordCount: number;
  byteSize: number;
  stale: boolean;
}

export interface CloudSchedulerRoutineState {
  id: string;
  name: string;
  enabled: boolean;
  locus: 'cloud' | 'device';
  schedule: unknown;
  timezone: string;
  nextDueAt: number | null;
}

export interface CloudSchedulerState {
  paired: boolean;
  schedulerLive?: boolean;
  agentExecution?: boolean;
  dryRun: boolean;
  generation: number;
  stateGeneration: number;
  autonomyEnabled: boolean;
  maxEventsPerDay: number;
  lastHeartbeatAt: number | null;
  lastSyncedAt: number | null;
  nextAlarmAt: number | null;
  routines: CloudSchedulerRoutineState[];
  context: CloudContextMetadata | null;
  journal: Array<{ at: number; kind: string; generation: number; routineId?: string; occurrence?: number; detail?: string }>;
}

export class AutonomyCloudError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

function base(pairing: AutonomyPairing): string {
  return pairing.workerUrl.replace(/\/+$/, '');
}

async function request(pairing: AutonomyPairing, path: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base(pairing)}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AutonomyCloudError('network', error instanceof Error ? error.message : 'The worker could not be reached.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function readError(response: Response): Promise<AutonomyCloudError> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  return new AutonomyCloudError(body?.code ?? `http-${response.status}`, body?.message ?? `The worker responded with HTTP ${response.status}.`, response.status);
}

/** Verify pairing: prove token possession and check version compatibility. */
export async function pairWithWorker(workerUrl: string, token: string): Promise<PairResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${workerUrl.replace(/\/+$/, '')}/autonomy/pair`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (error) {
    throw new AutonomyCloudError('network', error instanceof Error ? error.message : 'The worker could not be reached.', 0);
  } finally {
    clearTimeout(timeout);
  }
  if (response.status !== 200) throw await readError(response);
  const body = await response.json() as PairResult;
  if (body.schemaVersion !== AUTONOMY_SCHEMA_VERSION) {
    throw new AutonomyCloudError('version', `The worker speaks autonomy schema v${body.schemaVersion}; this app expects v${AUTONOMY_SCHEMA_VERSION}. Update the app or the worker.`, 0);
  }
  return body;
}

async function signedPost<T>(pairing: AutonomyPairing, path: string, body: string): Promise<T> {
  const timestamp = Date.now();
  const nonce = newNonce();
  const signature = await signWrite(pairing.token, 'POST', path, timestamp, nonce, body);
  const response = await request(pairing, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pairing.token}`,
      'X-Elara-Timestamp': String(timestamp),
      'X-Elara-Nonce': nonce,
      'X-Elara-Signature': signature,
    },
    body,
  });
  if (response.status !== 200) throw await readError(response);
  return await response.json() as T;
}

async function bearerGet<T>(pairing: AutonomyPairing, path: string): Promise<T> {
  const response = await request(pairing, path, { method: 'GET', headers: { Authorization: `Bearer ${pairing.token}` } });
  if (response.status !== 200) throw await readError(response);
  return await response.json() as T;
}

/** Sync the authoritative local configuration to the worker mirror. */
export async function syncConfig(pairing: AutonomyPairing, payload: ConfigSyncPayload): Promise<{ accepted: boolean; stateGeneration: number }> {
  return signedPost<{ accepted: boolean; stateGeneration: number }>(pairing, '/autonomy/config', JSON.stringify(payload));
}

/** Replace the worker-side Autonomy Context pack (atomic replace-all). */
export async function replaceContext(pairing: AutonomyPairing, pack: AutonomyContextPack): Promise<{ accepted: boolean; metadata: CloudContextMetadata }> {
  return signedPost<{ accepted: boolean; metadata: CloudContextMetadata }>(pairing, '/autonomy/context', JSON.stringify(pack));
}

/** Wipe the worker-side pack immediately. */
export async function clearContext(pairing: AutonomyPairing): Promise<{ accepted: boolean; metadata: CloudContextMetadata | null }> {
  return signedPost<{ accepted: boolean; metadata: CloudContextMetadata | null }>(pairing, '/autonomy/context', JSON.stringify({ clear: true }));
}

/** Scheduler observability: schedules, next alarm, journal, context metadata. */
export async function fetchSchedulerState(pairing: AutonomyPairing): Promise<CloudSchedulerState> {
  return bearerGet<CloudSchedulerState>(pairing, '/autonomy/state');
}

export interface HistoryPage<T> {
  items: T[];
  next: { at: number; id: string } | null;
  limit: number;
}

/** One keyset page of cloud run history (strictly after the cursor). */
export async function fetchCloudRunsPage(pairing: AutonomyPairing, afterAt: number, afterId: string, limit = 200): Promise<HistoryPage<RoutineRunRecord>> {
  const body = await bearerGet<{ runs: RoutineRunRecord[]; next: { at: number; id: string } | null; limit?: number }>(
    pairing,
    `/autonomy/runs?afterAt=${Math.max(0, Math.floor(afterAt))}&afterId=${encodeURIComponent(afterId)}&limit=${limit}`,
  );
  return { items: body.runs ?? [], next: body.next ?? null, limit: body.limit ?? limit };
}

export async function fetchCloudEventsPage(pairing: AutonomyPairing, afterAt: number, afterId: string, limit = 200): Promise<HistoryPage<import('../contracts').AutonomousEvent>> {
  const body = await bearerGet<{ events: import('../contracts').AutonomousEvent[]; next: { at: number; id: string } | null; limit?: number }>(
    pairing,
    `/autonomy/events?afterAt=${Math.max(0, Math.floor(afterAt))}&afterId=${encodeURIComponent(afterId)}&limit=${limit}`,
  );
  return { items: body.events ?? [], next: body.next ?? null, limit: body.limit ?? limit };
}
