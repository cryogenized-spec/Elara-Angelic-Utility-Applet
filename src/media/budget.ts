/**
 * Per-session search budget.
 *
 * Elara calls the YouTube Data API directly from the browser with the user's own
 * key, so there is no server that can rate-limit on the user's behalf. This
 * module is the replacement: a small, explicit allowance of network searches per
 * page session, spent only when the cache misses.
 *
 * Why it matters: `search.list` draws from its own dedicated quota bucket rather
 * than the shared daily pool, and there is no paid tier to raise it. A runaway
 * tool loop would exhaust the user's key for the rest of the Pacific-time day.
 *
 * Pure apart from the module-level ledger, and the clock is injectable so tests
 * never sleep.
 */

/** Network searches allowed per page session. Cached answers are free. */
export const SEARCH_BUDGET_PER_SESSION = 12;

export interface SearchBudget {
  readonly allowance: number;
  readonly spent: number;
  readonly remaining: number;
}

let allowance = SEARCH_BUDGET_PER_SESSION;
let spent = 0;

export function searchBudget(): SearchBudget {
  return Object.freeze({ allowance, spent, remaining: Math.max(0, allowance - spent) });
}

export function hasSearchBudget(): boolean {
  return spent < allowance;
}

/**
 * Reserve one search. Returns false when the budget is gone, so callers can
 * report `budget-exhausted` instead of issuing a call that should not happen.
 */
export function reserveSearch(): boolean {
  if (spent >= allowance) return false;
  spent += 1;
  return true;
}

/** Give a reservation back when the call never actually left the browser. */
export function releaseSearch(): void {
  spent = Math.max(0, spent - 1);
}

export function resetSearchBudget(nextAllowance: number = SEARCH_BUDGET_PER_SESSION): void {
  allowance = Math.max(0, nextAllowance);
  spent = 0;
}
