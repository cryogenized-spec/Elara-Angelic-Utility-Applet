import { listMemories } from '../../memory/store';
import { loadAutonomyPreferences } from '../../persistence/preferences';
import { addEventOrExisting, addRunOrExisting, listRoutines } from '../../persistence/autonomy';
import { buildAutonomyContext, type AutonomyContextProjection } from '../context';
import type { ElaraRoutine, RoutineRunRecord } from '../contracts';
import {
  adoptConfigGeneration,
  configGeneration,
  loadPairing,
  updatePairing,
  type AutonomyPairing,
} from './pairing';
import {
  clearContext,
  fetchCloudEvents,
  fetchCloudRuns,
  fetchSchedulerState,
  replaceContext,
  syncConfig,
  type CloudSchedulerState,
} from './client';

// ---------------------------------------------------------------------------
// Sync orchestration (design §8.5 sync lifecycle):
// - app open                → full sync (config + context + state/runs pull)
// - routine/autonomy change → config sync (generation-guarded)
// - manual refresh          → rebuild + sync, stats reported to the UI
// - manual clear            → immediate worker-side wipe
// - memory edited/deleted   → removed at the next replacement (atomic
//   replace-all; the worker never retains prior pack versions)
//
// The worker's OWN view decides whether the context needs syncing (its stored
// contentHash), so an externally cleared pack re-syncs even if the local
// bookkeeping thinks nothing changed. Failures are typed and surfaced — never
// silently ignored — and local data is always untouched (the mirror is
// disposable, the app is the source of truth).
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { phase: 'idle' }
  | { phase: 'syncing' }
  | { phase: 'synced'; at: number; detail: string }
  | { phase: 'error'; code: string; message: string };

export function currentPairing(): AutonomyPairing | null {
  return loadPairing();
}

/** Build the current Autonomy Context projection from the local memory store. */
export async function rebuildAutonomyContext(now = Date.now()): Promise<AutonomyContextProjection> {
  return buildAutonomyContext(await listMemories(), now);
}

/** Sync configuration (routines + master switch + event budget) with generation protection. */
export async function syncConfiguration(pairing: AutonomyPairing): Promise<{ generation: number; staleRejected: boolean }> {
  const [prefs, routines] = await Promise.all([loadAutonomyPreferences(), listRoutines()]);
  try {
    await syncConfig(pairing, {
      generation: configGeneration(),
      enabled: prefs.enabled,
      maxEventsPerDay: prefs.maxEventsPerDay,
      routines,
    });
    return { generation: configGeneration(), staleRejected: false };
  } catch (error) {
    if ((error as { code?: string }).code === 'stale-config') {
      // The worker holds a NEWER configuration (another app instance synced).
      // Adopt the counter so the next local change supersedes it — the older
      // payload is never re-pushed with a bumped number.
      const state = await fetchSchedulerState(pairing).catch(() => null);
      if (state) adoptConfigGeneration(state.generation);
      return { generation: configGeneration(), staleRejected: true };
    }
    throw error;
  }
}

/** Replace the worker-side pack when its stored contentHash differs from the current projection. */
async function syncContextIfChanged(pairing: AutonomyPairing, projection: AutonomyContextProjection, workerHash: string | null): Promise<boolean> {
  if (workerHash !== null && workerHash === projection.contentHash) return false;
  await replaceContext(pairing, { contentHash: projection.contentHash, records: projection.records });
  updatePairing({ lastSyncedContextHash: projection.contentHash });
  return true;
}

/** Pull cloud scheduler observations into the LOCAL run history (idempotent by runKey). */
export async function pullCloudRuns(pairing: AutonomyPairing): Promise<RoutineRunRecord[]> {
  const runs = await fetchCloudRuns(pairing, pairing.lastPulledRunsAt);
  let highest = pairing.lastPulledRunsAt;
  for (const run of runs) {
    await addRunOrExisting(run); // idempotent: the canonical record wins
    if (run.startedAt > highest) highest = run.startedAt;
  }
  if (highest > pairing.lastPulledRunsAt) updatePairing({ lastPulledRunsAt: highest });
  return runs;
}

export async function pullCloudEvents(pairing: AutonomyPairing): Promise<number> {
  const events = await fetchCloudEvents(pairing, pairing.lastPulledEventsAt);
  let highest = pairing.lastPulledEventsAt;
  for (const event of events) {
    await addEventOrExisting(event);
    if (event.createdAt > highest) highest = event.createdAt;
  }
  if (highest > pairing.lastPulledEventsAt) updatePairing({ lastPulledEventsAt: highest });
  return events.length;
}

/**
 * The full app-open sync: configuration, context (hash-guarded against the
 * worker's own view), scheduler state, and run-history pull. Returns the
 * pulled scheduler state for the UI.
 */
export async function fullSync(pairing: AutonomyPairing): Promise<{ state: CloudSchedulerState; pulledRuns: number; pulledEvents: number; contextSynced: boolean; staleRejected: boolean }> {
  const { staleRejected } = await syncConfiguration(pairing);
  const projection = await rebuildAutonomyContext();
  const before = await fetchSchedulerState(pairing);
  const contextSynced = await syncContextIfChanged(pairing, projection, before.context?.contentHash ?? null);
  const state = await fetchSchedulerState(pairing);
  const pulled = await pullCloudRuns(pairing);
  const pulledEvents = await pullCloudEvents(pairing);
  updatePairing({ lastSyncedAt: Date.now() });
  return { state, pulledRuns: pulled.length, pulledEvents, contextSynced, staleRejected };
}

/** Manual clear: wipe the worker-side pack immediately. */
export async function clearWorkerContext(pairing: AutonomyPairing): Promise<void> {
  await clearContext(pairing);
  updatePairing({ lastSyncedContextHash: null });
}

/** What would travel right now (the Inspect view), without syncing. */
export async function inspectContextProjection(): Promise<AutonomyContextProjection> {
  return rebuildAutonomyContext();
}

export type { ElaraRoutine, RoutineRunRecord };
