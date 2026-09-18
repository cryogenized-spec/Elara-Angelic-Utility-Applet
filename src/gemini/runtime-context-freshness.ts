import { shouldRefreshRuntimeContext } from './runtime-context';

/**
 * Application-level runtime-context freshness for the 30-minute stale boundary.
 *
 * This tracks WHEN the runtime wall-clock was last refreshed (wall-clock ms),
 * so the tool loop can decide whether the next model invocation must establish
 * a fresh clock. Freshness belongs to the application/runtime environment, NOT
 * to any individual conversation thread: switching threads never resets it,
 * and normal invocations never advance it — only a REAL refresh does.
 *
 * The persisted state is a single refresh timestamp — never the formatted
 * date/time, never memory, never World Canvas state, never conversation
 * content — in localStorage, so the boundary survives app suspension, app
 * death, restart, and thread restoration. Nothing runs while the app is
 * inactive; the check happens lazily on the next model invocation. Reads and
 * writes are synchronous and failure-swallowed: freshness bookkeeping must
 * never block or fail a Gemini turn.
 *
 * Success semantic: here a "refresh" means fresh runtime context was established
 * for (selected into) the outgoing invocation. `lastRefreshAt` records that
 * establishment time; it makes no claim about generation completion, and no
 * coupling to generation outcome is intended.
 *
 * Fail-open contract (deliberate): when freshness state is missing, corrupt,
 * or storage is unavailable, the turn refreshes (injects a fresh clock)
 * rather than skipping. For missing/corrupt state the refresh also self-heals
 * by recording the new timestamp. For unavailable storage nothing can be
 * recorded, so every turn refreshes — this preserves the pre-freshness
 * always-fresh observable behaviour in non-persistent environments instead of
 * silently starving the model of clock context.
 */

export const RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY = 'elara.runtime-context-freshness.v1';

export interface RuntimeContextFreshnessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RuntimeContextFreshnessStorage | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

/** Wall-clock ms at which fresh runtime context was last established for an invocation, or null when unknown. */
export function readLastRuntimeContextRefresh(
  storage: RuntimeContextFreshnessStorage | undefined = defaultStorage(),
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const lastRefreshAt = (parsed as Record<string, unknown>).lastRefreshAt;
    return typeof lastRefreshAt === 'number' && Number.isFinite(lastRefreshAt) ? lastRefreshAt : null;
  } catch {
    return null;
  }
}

/**
 * Record a REAL runtime-context refresh. Called only when a fresh clock was
 * actually established — never by the normal invocation path.
 */
export function recordRuntimeContextRefresh(
  nowMs: number,
  storage: RuntimeContextFreshnessStorage | undefined = defaultStorage(),
): void {
  if (!storage || !Number.isFinite(nowMs)) return;
  try {
    storage.setItem(RUNTIME_CONTEXT_FRESHNESS_STORAGE_KEY, JSON.stringify({ lastRefreshAt: nowMs }));
  } catch {
    // Freshness bookkeeping must never block a turn (private mode, quota, …).
  }
}

/**
 * Decide whether this model invocation must establish fresh runtime context.
 * On a refresh decision, records `nowMs` as the new refresh timestamp;
 * otherwise leaves the persisted timestamp untouched so the 30-minute window
 * is never reset or postponed by normal invocations.
 */
export function consumeRuntimeContextRefresh(
  nowMs: number,
  storage: RuntimeContextFreshnessStorage | undefined = defaultStorage(),
): boolean {
  if (!Number.isFinite(nowMs)) return true;
  const refresh = shouldRefreshRuntimeContext(readLastRuntimeContextRefresh(storage), nowMs);
  if (refresh) recordRuntimeContextRefresh(nowMs, storage);
  return refresh;
}
