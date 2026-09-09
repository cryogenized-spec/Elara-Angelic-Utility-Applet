import { z } from 'zod';
import { scoreMemoryForRanking } from '../memory/retrieval';
import type { DurableMemory } from '../memory/types';

// ---------------------------------------------------------------------------
// Autonomy Context (design doc §8.5) — the single, explicit, user-curated
// answer to "what has the user allowed Elara to know while she's away?"
//
// PURE shared code: the browser builds the projection, the Worker/DO
// re-validates it on receipt with the SAME schemas — the worker never trusts
// the browser merely because the browser generated the object. Nothing here
// may import persistence, Dexie, or the browser memory store; it consumes a
// structural snapshot (listMemories() output satisfies it) and exports a
// bounded projection.
//
// What never travels: relationship graphs, folder metadata, conversation ids,
// lifecycle/telemetry fields, and anything the user did not explicitly mark
// with the per-memory autonomyContext consent flag (default false).
// ---------------------------------------------------------------------------

export const AUTONOMY_CONTEXT_MAX_RECORDS = 200;
export const AUTONOMY_CONTEXT_MAX_BYTES = 100_000;
/** Beyond this age the pack is stale (shown in the UI; deliberately NOT a notification). */
export const AUTONOMY_CONTEXT_STALE_MS = 14 * 24 * 3_600_000;

/** Memory kinds that may travel: MICRO_OBSERVATION is excluded — unconfirmed inference must never feed autonomous inference. */
export const AUTONOMY_CONTEXT_KINDS = ['CORE', 'CONTEXTUAL', 'EPISODIC'] as const;
export type AutonomyContextKind = (typeof AUTONOMY_CONTEXT_KINDS)[number];

export const autonomyContextRecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: z.enum(AUTONOMY_CONTEXT_KINDS),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string().min(1).max(64)).max(32),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  observedAt: z.number().finite(),
  updatedAt: z.number().finite(),
});
export type AutonomyContextRecord = z.infer<typeof autonomyContextRecordSchema>;

/**
 * Structural input: the fields the projection reads from a durable memory.
 * `DurableMemory` satisfies this; the worker never imports the memory module.
 */
export type AutonomyContextSource = Readonly<Pick<DurableMemory, 'id' | 'kind' | 'title' | 'body' | 'tags' | 'importance' | 'confidence' | 'observedAt' | 'updatedAt' | 'lifecycle' | 'expiresAt' | 'autonomyContext' | 'relatedMemoryIds' | 'supportingMemoryIds' | 'conflictingMemoryIds' | 'reinforcementCount'>>;

/**
 * Eligibility (design §8.5 — all must hold):
 * lifecycle active; kind CORE/CONTEXTUAL/EPISODIC (never MICRO_OBSERVATION);
 * not expired; and the EXPLICIT per-memory autonomyContext consent flag. No
 * automatic inference ever includes a memory — consent is never inferred.
 */
export function isAutonomyContextEligible(memory: AutonomyContextSource, now: number): memory is AutonomyContextSource & { kind: AutonomyContextKind } {
  if (memory.lifecycle !== 'active') return false;
  if (memory.kind !== 'CORE' && memory.kind !== 'CONTEXTUAL' && memory.kind !== 'EPISODIC') return false;
  if (memory.expiresAt !== null && memory.expiresAt <= now) return false;
  return memory.autonomyContext === true;
}

export interface AutonomyContextProjection {
  records: AutonomyContextRecord[];
  recordCount: number;
  /** UTF-8 byte length of the canonical serialization. */
  byteSize: number;
  /** Stable SHA-256 of the canonical serialization — identical content ⇒ identical hash. */
  contentHash: string;
  /** True when eligible consented memories were dropped to fit the budgets. */
  truncated: boolean;
}

/** Canonical serialization: fixed field order (schema order) + deterministic record order. */
export function serializeAutonomyContext(records: readonly AutonomyContextRecord[]): string {
  return JSON.stringify(records.map((record) => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    body: record.body,
    tags: record.tags,
    importance: record.importance,
    confidence: record.confidence,
    observedAt: record.observedAt,
    updatedAt: record.updatedAt,
  })));
}

export function autonomyContextByteSize(records: readonly AutonomyContextRecord[]): number {
  return new TextEncoder().encode(serializeAutonomyContext(records)).length;
}

/** SHA-256 hex of the canonical serialization (available in browser, Worker, and Node ≥ 18). */
export async function hashAutonomyContext(records: readonly AutonomyContextRecord[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeAutonomyContext(records)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the bounded Autonomy Context projection. Deterministic by
 * construction: eligible memories are ranked with the EXISTING retrieval
 * scorer (query-less) and truncated in a stable order (score desc, then id
 * asc), so equivalent memory sets always produce identical ordering — and
 * therefore an identical contentHash across rebuilds.
 */
export async function buildAutonomyContext(memories: readonly AutonomyContextSource[], now: number): Promise<AutonomyContextProjection> {
  const eligible = memories.filter((memory) => isAutonomyContextEligible(memory, now));
  const ranked = eligible
    .map((memory) => ({ memory, score: scoreMemoryForRanking(memory, now) }))
    .sort((a, b) => b.score - a.score || (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0));

  const records: AutonomyContextRecord[] = [];
  let truncated = false;
  for (const { memory } of ranked) {
    if (records.length >= AUTONOMY_CONTEXT_MAX_RECORDS) { truncated = true; break; }
    const candidate: AutonomyContextRecord = {
      id: memory.id,
      kind: memory.kind,
      title: memory.title,
      body: memory.body,
      tags: [...memory.tags],
      importance: memory.importance,
      confidence: memory.confidence,
      observedAt: memory.observedAt,
      updatedAt: memory.updatedAt,
    };
    const projected = [...records, candidate];
    if (autonomyContextByteSize(projected) > AUTONOMY_CONTEXT_MAX_BYTES) { truncated = true; break; }
    records.push(candidate);
  }
  return {
    records,
    recordCount: records.length,
    byteSize: autonomyContextByteSize(records),
    contentHash: await hashAutonomyContext(records),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Wire pack + worker-side validation
// ---------------------------------------------------------------------------

export const autonomyContextPackSchema = z.strictObject({
  contentHash: z.string().length(64),
  records: z.array(autonomyContextRecordSchema).max(AUTONOMY_CONTEXT_MAX_RECORDS),
});
export type AutonomyContextPack = z.infer<typeof autonomyContextPackSchema>;

export type AutonomyContextValidation =
  | { ok: true; pack: AutonomyContextPack; byteSize: number }
  | { ok: false; code: 'malformed' | 'too-many-records' | 'too-large' | 'hash-mismatch' };

/**
 * Validate a received pack the way the WORKER must: strict schema (unknown
 * structure is never silently accepted), record count, serialized byte size,
 * and reconstructible content hash. Malformed or oversized payloads fail
 * closed. Pure and shared so the app can pre-validate before sending.
 */
export async function validateAutonomyContextPack(value: unknown): Promise<AutonomyContextValidation> {
  const parsed = autonomyContextPackSchema.safeParse(value);
  if (!parsed.success) {
    // Distinguish the count violation for honest diagnostics.
    const rawRecords = (value as { records?: unknown } | null)?.records;
    if (Array.isArray(rawRecords) && rawRecords.length > AUTONOMY_CONTEXT_MAX_RECORDS) return { ok: false, code: 'too-many-records' };
    return { ok: false, code: 'malformed' };
  }
  const byteSize = autonomyContextByteSize(parsed.data.records);
  if (byteSize > AUTONOMY_CONTEXT_MAX_BYTES) return { ok: false, code: 'too-large' };
  const contentHash = await hashAutonomyContext(parsed.data.records);
  if (contentHash !== parsed.data.contentHash) return { ok: false, code: 'hash-mismatch' };
  return { ok: true, pack: parsed.data, byteSize };
}
