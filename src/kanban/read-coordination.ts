import { liveQuery, type Table } from 'dexie';
import { READ_TIMEOUT_MS } from './sync-policy';

/** Browser-local read scheduling only. Never contains credentials or mutations. */
export interface ReadSchedule {
  account: string;
  owner: string | null;
  leaseUntil: number;
  lastSuccessAt: number;
  failures: number;
  nextRetryAt: number | null;
  paused: boolean;
  error: string | null;
}
export const READ_LEASE_MS = READ_TIMEOUT_MS + 5000;
export const emptySchedule = (account: string): ReadSchedule => ({
  account, owner: null, leaseUntil: 0, lastSuccessAt: 0,
  failures: 0, nextRetryAt: null, paused: false, error: null,
});
export type ReadClaim = { kind: 'acquired' | 'waiting' | 'blocked' | 'fresh'; schedule: ReadSchedule };

/** Serial IDB transactions elect one reader per account; expiry handles crashed tabs. */
export async function claimRead(table: Table<ReadSchedule, string>, account: string, owner: string,
  freshAfter: number, manual: boolean, now = Date.now()): Promise<ReadClaim> {
  return table.db.transaction('rw', table, async () => {
    const schedule = await table.get(account) ?? emptySchedule(account);
    if (schedule.owner && schedule.leaseUntil > now) return { kind: 'waiting', schedule };
    if ((schedule.nextRetryAt !== null && schedule.nextRetryAt > now) || (schedule.paused && !manual)) return { kind: 'blocked', schedule };
    if (!manual && schedule.failures === 0 && schedule.lastSuccessAt > 0 && schedule.lastSuccessAt >= freshAfter) return { kind: 'fresh', schedule };
    const claimed = { ...schedule, owner, leaseUntil: now + READ_LEASE_MS, failures: manual && schedule.paused ? 0 : schedule.failures };
    await table.put(claimed);
    return { kind: 'acquired', schedule: claimed };
  });
}

/** Fencing: an expired/replaced reader cannot commit a snapshot or clear a newer lease. */
export async function ownsRead(table: Table<ReadSchedule, string>, account: string, owner: string): Promise<boolean> {
  const schedule = await table.get(account);
  return schedule?.owner === owner && schedule.leaseUntil > Date.now();
}
export async function releaseRead(table: Table<ReadSchedule, string>, account: string, owner: string,
  result: Partial<Pick<ReadSchedule, 'lastSuccessAt' | 'failures' | 'nextRetryAt' | 'paused' | 'error'>> = {}): Promise<boolean> {
  return table.db.transaction('rw', table, async () => {
    if (!await ownsRead(table, account, owner)) return false;
    await table.update(account, { ...result, owner: null, leaseUntil: 0 });
    return true;
  });
}

/** Event-driven local wait: one expiry wake-up, no polling in a suspended PWA. */
export function waitForReader(table: Table<ReadSchedule, string>, observed: ReadSchedule, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const finish = (error?: unknown) => {
      clearTimeout(timer); subscription?.unsubscribe(); signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error instanceof Error ? error : new Error('Read coordination interrupted.')); else resolve();
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(), Math.max(0, observed.leaseUntil - Date.now()));
    signal.addEventListener('abort', abort, { once: true });
    const subscription = liveQuery(() => table.get(observed.account)).subscribe({
      next: (latest) => { if (JSON.stringify(latest) !== JSON.stringify(observed)) finish(); },
      error: finish,
    });
  });
}
