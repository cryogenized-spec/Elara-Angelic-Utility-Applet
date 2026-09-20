import { db, type StoredGeminiQuotaLedger } from '../persistence/conversation';

const LEDGER_ID = 'gemini-quota-ledger-v1' as const;
const WINDOW_MS = 60_000;
const CHANNEL_NAME = 'elara-gemini-quota-ledger-v1';
const DEFAULT_FIRST_RESERVE = 30_000;
const MIN_RESERVE = 20_000;
const RECENT_RESERVE_MULTIPLIER = 1.15;
const IMAGE_INPUT_TOKEN_RESERVE = 12_000;

export const DEFAULT_GEMINI_ROLLING_INPUT_ALLOWANCE = 200_000;

export interface GeminiQuotaSnapshot {
  readonly rollingInputTokens: number;
  readonly allowance: number;
  readonly remaining: number;
  readonly entries: number;
}

export type GeminiQuotaReservation =
  | {
      readonly granted: true;
      readonly id: string;
      readonly startedAt: number;
      readonly reservedInputTokens: number;
      readonly rollingInputTokens: number;
    }
  | {
      readonly granted: false;
      readonly retryAfterMs: number;
      readonly rollingInputTokens: number;
      readonly projectedInputTokens: number;
      readonly allowance: number;
      readonly reason: 'rolling-budget' | 'ledger-unavailable';
    };

let channel: BroadcastChannel | undefined;
let mirroredSnapshot: { rollingInputTokens: number; at: number } | undefined;

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validEntry(value: unknown): value is StoredGeminiQuotaLedger['entries'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && finiteNonNegativeInteger(record.startedAt)
    && finiteNonNegativeInteger(record.reservedInputTokens)
    && (record.actualInputTokens === undefined || finiteNonNegativeInteger(record.actualInputTokens));
}

function validLedger(value: unknown): value is StoredGeminiQuotaLedger {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.id === LEDGER_ID
    && finiteNonNegativeInteger(record.updatedAt)
    && Array.isArray(record.entries)
    && record.entries.every(validEntry);
}

function effectiveTokens(entry: StoredGeminiQuotaLedger['entries'][number]): number {
  return entry.actualInputTokens ?? entry.reservedInputTokens;
}

function activeEntries(entries: readonly StoredGeminiQuotaLedger['entries'][number][], now: number) {
  const floor = now - WINDOW_MS;
  return entries.filter((entry) => entry.startedAt > floor);
}

function rollingTotal(entries: readonly StoredGeminiQuotaLedger['entries'][number][]): number {
  return entries.reduce((sum, entry) => sum + effectiveTokens(entry), 0);
}

function normalizedEstimate(estimatedInputTokens: number | undefined, entries: readonly StoredGeminiQuotaLedger['entries'][number][]): number {
  const estimate = finiteNonNegativeInteger(estimatedInputTokens) ? estimatedInputTokens : 0;
  const recentMaximum = entries.reduce((max, entry) => Math.max(max, effectiveTokens(entry)), 0);
  const adaptive = recentMaximum > 0 ? Math.ceil(recentMaximum * RECENT_RESERVE_MULTIPLIER) : DEFAULT_FIRST_RESERVE;
  return Math.max(MIN_RESERVE, estimate, adaptive);
}

function retryAfterFor(
  entries: readonly StoredGeminiQuotaLedger['entries'][number][],
  reserve: number,
  allowance: number,
  now: number,
): number {
  let remaining = rollingTotal(entries);
  const ordered = [...entries].sort((left, right) => left.startedAt - right.startedAt);
  for (const entry of ordered) {
    remaining -= effectiveTokens(entry);
    if (remaining + reserve <= allowance) {
      return Math.max(100, entry.startedAt + WINDOW_MS - now + 100);
    }
  }
  return WINDOW_MS;
}

function snapshot(entries: readonly StoredGeminiQuotaLedger['entries'][number][], allowance: number): GeminiQuotaSnapshot {
  const rollingInputTokens = rollingTotal(entries);
  return Object.freeze({
    rollingInputTokens,
    allowance,
    remaining: Math.max(0, allowance - rollingInputTokens),
    entries: entries.length,
  });
}

function isSnapshotMessage(value: unknown): value is { rollingInputTokens: number; at: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return finiteNonNegativeInteger(record.rollingInputTokens) && finiteNonNegativeInteger(record.at);
}

function ensureChannel(): BroadcastChannel | undefined {
  if (channel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isSnapshotMessage(event.data)) mirroredSnapshot = event.data;
  });
  return channel;
}

function publish(value: GeminiQuotaSnapshot, now: number): void {
  mirroredSnapshot = { rollingInputTokens: value.rollingInputTokens, at: now };
  try {
    ensureChannel()?.postMessage(mirroredSnapshot);
  } catch {
    // IndexedDB is authoritative; notification is only a best-effort wake-up.
  }
}

function staleCorruptRow(value: unknown, now: number): boolean {
  if (!value || typeof value !== 'object') return true;
  const updatedAt = (value as Record<string, unknown>).updatedAt;
  // An invalid/missing timestamp cannot establish a live reservation window.
  // Treat it as replaceable corruption rather than permanently bricking local
  // admission; cleanup itself still happens only inside the write transaction.
  return !finiteNonNegativeInteger(updatedAt) || updatedAt <= now - WINDOW_MS;
}

export async function geminiQuotaSnapshot(
  now: number = Date.now(),
  allowance: number = DEFAULT_GEMINI_ROLLING_INPUT_ALLOWANCE,
): Promise<GeminiQuotaSnapshot> {
  ensureChannel();
  const row = await db.settings.get(LEDGER_ID);
  if (row && !validLedger(row)) {
    if (!staleCorruptRow(row, now)) return snapshot([{ id: 'corrupt', startedAt: now, reservedInputTokens: allowance }], allowance);
    // Snapshot reads never mutate the authority. A reservation transaction is
    // the sole place stale corruption may be removed/replaced, preventing a
    // stale reader in one tab from deleting a fresh reservation from another.
    return snapshot([], allowance);
  }
  return snapshot(activeEntries(row?.entries ?? [], now), allowance);
}

export async function reserveGeminiQuota(
  estimatedInputTokens?: number,
  now: number = Date.now(),
  allowance: number = DEFAULT_GEMINI_ROLLING_INPUT_ALLOWANCE,
): Promise<GeminiQuotaReservation> {
  ensureChannel();
  let result: GeminiQuotaReservation = {
    granted: false,
    retryAfterMs: WINDOW_MS,
    rollingInputTokens: allowance,
    projectedInputTokens: allowance,
    allowance,
    reason: 'ledger-unavailable',
  };

  try {
    await db.transaction('rw', db.settings, async () => {
      const raw = await db.settings.get(LEDGER_ID);
      if (raw && !validLedger(raw)) {
        if (!staleCorruptRow(raw, now)) return;
        await db.settings.delete(LEDGER_ID);
      }
      const row = validLedger(raw) ? raw : undefined;
      const entries = activeEntries(row?.entries ?? [], now);
      const rollingInputTokens = rollingTotal(entries);
      const reserve = normalizedEstimate(estimatedInputTokens, entries);
      const projectedInputTokens = rollingInputTokens + reserve;
      if (projectedInputTokens > allowance) {
        result = {
          granted: false,
          retryAfterMs: retryAfterFor(entries, reserve, allowance, now),
          rollingInputTokens,
          projectedInputTokens,
          allowance,
          reason: 'rolling-budget',
        };
        return;
      }

      const id = crypto.randomUUID();
      const nextEntries = [...entries, { id, startedAt: now, reservedInputTokens: reserve }].slice(-64);
      const next: StoredGeminiQuotaLedger = { id: LEDGER_ID, entries: nextEntries, updatedAt: now };
      await db.settings.put(next);
      result = { granted: true, id, startedAt: now, reservedInputTokens: reserve, rollingInputTokens: projectedInputTokens };
    });
  } catch {
    return result;
  }

  if (result.granted) publish(await geminiQuotaSnapshot(now, allowance), now);
  return result;
}

export async function finalizeGeminiQuotaReservation(
  reservation: Extract<GeminiQuotaReservation, { granted: true }>,
  actualInputTokens: number | undefined,
  now: number = Date.now(),
  allowance: number = DEFAULT_GEMINI_ROLLING_INPUT_ALLOWANCE,
): Promise<void> {
  if (!finiteNonNegativeInteger(actualInputTokens)) {
    publish(await geminiQuotaSnapshot(now, allowance), now);
    return;
  }

  try {
    let nextSnapshot: GeminiQuotaSnapshot | undefined;
    await db.transaction('rw', db.settings, async () => {
      const raw = await db.settings.get(LEDGER_ID);
      if (!validLedger(raw)) return;
      const entries = activeEntries(raw.entries, now).map((entry) =>
        entry.id === reservation.id ? { ...entry, actualInputTokens } : entry,
      );
      await db.settings.put({ id: LEDGER_ID, entries, updatedAt: now } satisfies StoredGeminiQuotaLedger);
      nextSnapshot = snapshot(entries, allowance);
    });
    if (nextSnapshot) publish(nextSnapshot, now);
  } catch {
    // Conservative failure: the reservation remains charged at its estimate.
  }
}

export async function releaseGeminiQuotaReservation(
  reservation: Extract<GeminiQuotaReservation, { granted: true }>,
  now: number = Date.now(),
  allowance: number = DEFAULT_GEMINI_ROLLING_INPUT_ALLOWANCE,
): Promise<void> {
  try {
    let nextSnapshot: GeminiQuotaSnapshot | undefined;
    await db.transaction('rw', db.settings, async () => {
      const raw = await db.settings.get(LEDGER_ID);
      if (!validLedger(raw)) return;
      const entries = activeEntries(raw.entries, now).filter((entry) => entry.id !== reservation.id);
      await db.settings.put({ id: LEDGER_ID, entries, updatedAt: now } satisfies StoredGeminiQuotaLedger);
      nextSnapshot = snapshot(entries, allowance);
    });
    if (nextSnapshot) publish(nextSnapshot, now);
  } catch {
    // Conservative failure: retaining a reservation can only reduce request rate.
  }
}

export function estimateSerializedInputTokens(value: unknown): number {
  try {
    let mediaReserve = 0;
    const serialized = typeof value === 'string'
      ? value
      : JSON.stringify(value, (_key, current: unknown) => {
          if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
          const record = current as Record<string, unknown>;
          if (record.type !== 'image') return current;
          if (typeof record.data !== 'string' && typeof record.uri !== 'string') return current;
          mediaReserve += IMAGE_INPUT_TOKEN_RESERVE;
          return typeof record.data === 'string'
            ? { ...record, data: '[inline-image-bytes]' }
            : current;
        });
    // Deliberately conservative and tokenizer-independent. Base64 is transport
    // encoding, not prompt text, so image bytes are represented by a fixed
    // safety reserve. Provider usage replaces this estimate whenever available.
    return Math.max(1, Math.ceil(serialized.length / 4) + mediaReserve);
  } catch {
    return MIN_RESERVE;
  }
}

export function mirroredGeminiQuotaUsage(): number | undefined {
  return mirroredSnapshot?.rollingInputTokens;
}

/** Test/support seam; production state expires naturally after 60 seconds. */
export async function resetGeminiQuotaLedgerForTests(): Promise<void> {
  mirroredSnapshot = undefined;
  await db.settings.delete(LEDGER_ID);
}
