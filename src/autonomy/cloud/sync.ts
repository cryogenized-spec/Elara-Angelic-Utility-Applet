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
  fetchCloudEventsPage,
  fetchCloudRunsPage,
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
    const code = (error as { code?: string }).code;
    if (code === 'stale-config' || code === 'config-conflict') {
      // Worker generation is authoritative. Adopt it; do not bump and replay
      // the rejected local payload. The next local edit supersedes.
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

/** Pull cloud history by keyset pages. Cursor advances only after a page is stored. */
export async function pullCloudRuns(pairing: AutonomyPairing): Promise<RoutineRunRecord[]> {
  const collected: RoutineRunRecord[] = [];
  let afterAt = pairing.lastPulledRunsAt;
  let afterId = pairing.lastPulledRunsId ?? '';
  for (;;) {
    const page = await fetchCloudRunsPage(pairing, afterAt, afterId);
    for (const run of page.items) await addRunOrExisting(run);
    collected.push(...page.items);
    if (page.items.length === 0) break;
    const last = page.items[page.items.length - 1]!;
    afterAt = last.startedAt;
    afterId = last.id;
    updatePairing({ lastPulledRunsAt: afterAt, lastPulledRunsId: afterId });
    if (!page.next || page.items.length < page.limit) break;
  }
  return collected;
}

export async function pullCloudEvents(pairing: AutonomyPairing): Promise<number> {
  let count = 0;
  let afterAt = pairing.lastPulledEventsAt;
  let afterId = pairing.lastPulledEventsId ?? '';
  for (;;) {
    const page = await fetchCloudEventsPage(pairing, afterAt, afterId);
    for (const event of page.items) await addEventOrExisting(event);
    count += page.items.length;
    if (page.items.length === 0) break;
    const last = page.items[page.items.length - 1]!;
    afterAt = last.createdAt;
    afterId = last.id;
    updatePairing({ lastPulledEventsAt: afterAt, lastPulledEventsId: afterId });
    if (!page.next || page.items.length < page.limit) break;
  }
  return count;
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
