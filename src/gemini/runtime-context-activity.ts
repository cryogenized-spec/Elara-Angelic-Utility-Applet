import { shouldRefreshRuntimeContext } from './runtime-context';

/**
 * Session-level per-thread last-invocation activity for the 30-minute stale
 * runtime-context boundary.
 *
 * This tracks WHEN each thread last invoked the model (wall-clock ms) so the
 * tool loop can decide whether the next invocation re-establishes fresh
 * wall-clock context. It stores only activity timestamps — never the clock
 * itself, never memory, never world state — in localStorage so the boundary
 * survives app suspension/resume and normal thread restoration. Reads and
 * writes are synchronous and failure-swallowed: activity tracking must never
 * block or fail a Gemini turn.
 */

export const RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY = 'elara.runtime-context-activity.v1';

export interface RuntimeContextActivityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RuntimeContextActivityStorage | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

function readActivities(storage: RuntimeContextActivityStorage | undefined): Record<string, number> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [threadId, timestamp] of Object.entries(parsed as Record<string, unknown>)) {
      if (threadId && typeof timestamp === 'number' && Number.isFinite(timestamp)) result[threadId] = timestamp;
    }
    return result;
  } catch {
    return {};
  }
}

/** Last recorded model-invocation activity for a thread, or null when unknown. */
export function readRuntimeContextActivity(
  threadId: string,
  storage: RuntimeContextActivityStorage | undefined = defaultStorage(),
): number | null {
  if (!threadId) return null;
  return readActivities(storage)[threadId] ?? null;
}

/** Record a model invocation as thread activity. */
export function recordRuntimeContextActivity(
  threadId: string,
  nowMs: number,
  storage: RuntimeContextActivityStorage | undefined = defaultStorage(),
): void {
  if (!threadId || !storage || !Number.isFinite(nowMs)) return;
  try {
    const activities = readActivities(storage);
    activities[threadId] = nowMs;
    storage.setItem(RUNTIME_CONTEXT_ACTIVITY_STORAGE_KEY, JSON.stringify(activities));
  } catch {
    // Activity tracking must never block a turn (private mode, quota, …).
  }
}

/**
 * Decide whether this invocation establishes fresh runtime context, and record
 * the invocation as thread activity.
 *
 * Recording happens on EVERY invocation — refresh or not — because the
 * boundary measures continuous INACTIVITY between invocations, not time since
 * the last refresh. A turn without thread identity (or without storage)
 * fails open to a refresh without recording, preserving the previous
 * always-fresh behaviour for unidentified turns.
 */
export function consumeRuntimeContextRefresh(
  threadId: string | null | undefined,
  nowMs: number,
  storage: RuntimeContextActivityStorage | undefined = defaultStorage(),
): boolean {
  if (!threadId) return true;
  const refresh = shouldRefreshRuntimeContext(readActivities(storage)[threadId] ?? null, nowMs);
  recordRuntimeContextActivity(threadId, nowMs, storage);
  return refresh;
}
