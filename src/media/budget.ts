import { mediaDb, type MediaDailySearchBudgetEntry } from './storage';

/**
 * YouTube search budget authority.
 *
 * Two ceilings protect the provider's dedicated `search.list` allowance:
 *
 * 1. A small in-memory per-page-session budget stops one runaway tool loop.
 * 2. A device-local Pacific-day ledger in the existing media IndexedDB prevents
 *    reloads and additional tabs from repeatedly resetting that safety ceiling.
 *
 * IndexedDB is authoritative across tabs because read/write transactions on the
 * one budget row serialize reservations. BroadcastChannel mirrors successful
 * observations so an already-exhausted sibling can refuse without another DB
 * transaction, but correctness never depends on receiving a message.
 */

/** Network searches allowed per page session. Cached answers are free. */
export const SEARCH_BUDGET_PER_SESSION = 8;
/** Conservative device-local ceiling inside YouTube's default 100 searches/day. */
export const SEARCH_BUDGET_PER_DEVICE_DAY = 24;

const DAILY_BUDGET_ID = 'youtube-search' as const;
const QUOTA_TIME_ZONE = 'America/Los_Angeles';
const BUDGET_CHANNEL_NAME = 'elara-youtube-search-budget-v1';

export interface SearchBudget {
  readonly allowance: number;
  readonly spent: number;
  readonly remaining: number;
}

export interface DailySearchBudget {
  readonly quotaDay: string;
  readonly allowance: number;
  readonly spent: number;
  readonly remaining: number;
}

export type SearchReservation =
  | { readonly granted: true; readonly quotaDay: string }
  | { readonly granted: false; readonly scope: 'session' | 'daily' | 'daily-unavailable' };

let allowance = SEARCH_BUDGET_PER_SESSION;
let spent = 0;
let dailyAllowance = SEARCH_BUDGET_PER_DEVICE_DAY;
let budgetChannel: BroadcastChannel | undefined;
let mirroredDaily: DailySearchBudget | undefined;

function quotaDateParts(now: number): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: value('year'), month: value('month'), day: value('day') };
}

/** Provider quota days reset at midnight Pacific Time, not the device timezone. */
export function youtubeQuotaDay(now: number = Date.now()): string {
  if (!Number.isFinite(now)) throw new Error('A finite timestamp is required for the YouTube quota day.');
  const { year, month, day } = quotaDateParts(now);
  if (!year || !month || !day) throw new Error('The YouTube quota day could not be resolved.');
  return `${year}-${month}-${day}`;
}

function snapshot(quotaDay: string, currentSpent: number): DailySearchBudget {
  const safeSpent = Math.max(0, Math.floor(currentSpent));
  return Object.freeze({
    quotaDay,
    allowance: dailyAllowance,
    spent: safeSpent,
    remaining: Math.max(0, dailyAllowance - safeSpent),
  });
}

/**
 * Persisted quota state is untrusted input. A malformed same-day counter must not
 * grant fresh budget, so corruption is interpreted as fully exhausted. A row
 * from an older provider day is intentionally irrelevant and starts from zero.
 */
function persistedSpentForDay(row: MediaDailySearchBudgetEntry | undefined, quotaDay: string): number {
  if (!row || row.quotaDay !== quotaDay) return 0;
  return Number.isInteger(row.spent) && row.spent >= 0 ? row.spent : dailyAllowance;
}

function isBudgetMessage(value: unknown): value is { quotaDay: string; spent: number } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.quotaDay === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(record.quotaDay)
    && typeof record.spent === 'number'
    && Number.isInteger(record.spent)
    && record.spent >= 0;
}

function ensureBudgetChannel(): BroadcastChannel | undefined {
  if (budgetChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return budgetChannel;
  budgetChannel = new BroadcastChannel(BUDGET_CHANNEL_NAME);
  budgetChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isBudgetMessage(event.data)) return;
    mirroredDaily = snapshot(event.data.quotaDay, event.data.spent);
  });
  return budgetChannel;
}

function publishDailyBudget(value: DailySearchBudget): void {
  mirroredDaily = value;
  try {
    ensureBudgetChannel()?.postMessage({ quotaDay: value.quotaDay, spent: value.spent });
  } catch {
    // IndexedDB remains authoritative; cross-tab notification is best effort.
  }
}

export function searchBudget(): SearchBudget {
  return Object.freeze({ allowance, spent, remaining: Math.max(0, allowance - spent) });
}

export function hasSearchBudget(): boolean {
  return spent < allowance;
}

/** Read the authoritative device-local daily search ledger. */
export async function dailySearchBudget(now: number = Date.now()): Promise<DailySearchBudget> {
  const quotaDay = youtubeQuotaDay(now);
  const row = await mediaDb.dailySearchBudget.get(DAILY_BUDGET_ID);
  const value = snapshot(quotaDay, persistedSpentForDay(row, quotaDay));
  publishDailyBudget(value);
  return value;
}

/**
 * Reserve one real provider search against both ceilings.
 *
 * Session spending increments synchronously before the first await so concurrent
 * searches in one tab cannot race past the in-memory ceiling. The persistent
 * transaction then serializes this reservation with every other tab on the same
 * origin. Failure to read/write the daily ledger fails closed: quota protection
 * is more important than issuing an unaccounted provider request.
 */
export async function reserveSearch(now: number = Date.now()): Promise<SearchReservation> {
  if (spent >= allowance) return Object.freeze({ granted: false, scope: 'session' });
  spent += 1;

  let quotaDay: string;
  try {
    quotaDay = youtubeQuotaDay(now);
  } catch {
    spent = Math.max(0, spent - 1);
    return Object.freeze({ granted: false, scope: 'daily-unavailable' });
  }

  // Start listening before the authoritative transaction. A mirror can only
  // refuse early; it can never grant budget, so a stale message cannot overspend.
  ensureBudgetChannel();
  if (mirroredDaily?.quotaDay === quotaDay && mirroredDaily.remaining <= 0) {
    spent = Math.max(0, spent - 1);
    return Object.freeze({ granted: false, scope: 'daily' });
  }

  let granted = false;
  let resultingSpent = 0;
  try {
    await mediaDb.transaction('rw', mediaDb.dailySearchBudget, async () => {
      const existing = await mediaDb.dailySearchBudget.get(DAILY_BUDGET_ID);
      const currentSpent = persistedSpentForDay(existing, quotaDay);
      resultingSpent = currentSpent;
      if (currentSpent >= dailyAllowance) return;

      resultingSpent = currentSpent + 1;
      const row: MediaDailySearchBudgetEntry = {
        id: DAILY_BUDGET_ID,
        quotaDay,
        spent: resultingSpent,
        updatedAt: now,
      };
      await mediaDb.dailySearchBudget.put(row);
      granted = true;
    });
  } catch {
    spent = Math.max(0, spent - 1);
    return Object.freeze({ granted: false, scope: 'daily-unavailable' });
  }

  publishDailyBudget(snapshot(quotaDay, resultingSpent));
  if (!granted) {
    spent = Math.max(0, spent - 1);
    return Object.freeze({ granted: false, scope: 'daily' });
  }
  return Object.freeze({ granted: true, quotaDay });
}

/**
 * Return a reservation only when the provider request provably never left the
 * browser. A failed persistent refund remains conservatively counted rather than
 * risking an accidental overrun.
 */
export async function releaseSearch(reservation?: SearchReservation, now: number = Date.now()): Promise<void> {
  spent = Math.max(0, spent - 1);
  if (!reservation?.granted) return;

  try {
    let resultingSpent = 0;
    await mediaDb.transaction('rw', mediaDb.dailySearchBudget, async () => {
      const existing = await mediaDb.dailySearchBudget.get(DAILY_BUDGET_ID);
      if (!existing || existing.quotaDay !== reservation.quotaDay) return;
      const currentSpent = persistedSpentForDay(existing, reservation.quotaDay);
      resultingSpent = Math.max(0, currentSpent - 1);
      await mediaDb.dailySearchBudget.put({ ...existing, spent: resultingSpent, updatedAt: now });
    });
    publishDailyBudget(snapshot(reservation.quotaDay, resultingSpent));
  } catch {
    // Conservative failure: retaining one spent slot can only reduce API usage.
  }
}

export function resetSearchBudget(nextAllowance: number = SEARCH_BUDGET_PER_SESSION): void {
  allowance = Math.max(0, Math.floor(nextAllowance));
  spent = 0;
}

/** Test/support seam. Production quota state normally rolls over by Pacific day. */
export async function resetDailySearchBudget(nextAllowance: number = SEARCH_BUDGET_PER_DEVICE_DAY): Promise<void> {
  dailyAllowance = Math.max(0, Math.floor(nextAllowance));
  mirroredDaily = undefined;
  await mediaDb.dailySearchBudget.delete(DAILY_BUDGET_ID);
}
