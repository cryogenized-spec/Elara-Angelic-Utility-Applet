import type { DurableMemory, MemoryInput, MemoryKind, MemoryRetrievalScope, RetrievedMemory } from './types';
import { durableMemorySchema } from './schema';
import { clampUnitInterval, normalizeIds, normalizeMemoryInput, normalizeProvenance, normalizeTags, normalizeTitle, normalizeBody } from './normalize';
import { createMemoryId } from './ids';
import { db } from '../persistence/conversation';
import { formatMemoryContext, rankAndBudgetMemories } from './retrieval';

const PROMOTION_ORDER: MemoryKind[] = ['MICRO_OBSERVATION', 'EPISODIC', 'CONTEXTUAL', 'CORE'];

type MemoryTable = {
  put(value: DurableMemory): Promise<unknown>;
  get(key: string): Promise<DurableMemory | undefined>;
  delete(key: string): Promise<unknown>;
  count(): Promise<number>;
  orderBy(index: string): { reverse(): { toArray(): Promise<DurableMemory[]> } };
};

function table(): MemoryTable { return db.memories as unknown as MemoryTable; }
function validate(record: DurableMemory): DurableMemory {
  const result = durableMemorySchema.safeParse(record);
  if (!result.success) throw new Error('Invalid durable memory record.');
  return result.data;
}

export async function saveMemory(input: MemoryInput): Promise<DurableMemory> {
  const now = Date.now();
  const normalized = normalizeMemoryInput(input, now);
  const record = validate({
    id: createMemoryId(), kind: normalized.kind!, title: normalized.title, body: normalized.body,
    createdAt: now, updatedAt: now, observedAt: normalized.observedAt!, confidence: normalized.confidence!, importance: normalized.importance!,
    lifecycle: normalized.lifecycle!, source: normalized.source!, tags: normalized.tags!, relatedMemoryIds: normalized.relatedMemoryIds!,
    supportingMemoryIds: normalized.supportingMemoryIds!, conflictingMemoryIds: normalized.conflictingMemoryIds!, supersedes: normalized.supersedes!,
    supersededBy: normalized.supersededBy!, reinforcementCount: 0, folderId: normalized.folderId ?? null, expiresAt: normalized.expiresAt ?? null,
    lastRecalledAt: null, recallCount: 0,
  });
  await table().put(record);
  return record;
}

export async function getMemory(id: string): Promise<DurableMemory | undefined> { const record = await table().get(id); return record ? validate(record) : undefined; }
export async function listMemories(): Promise<DurableMemory[]> { return (await table().orderBy('updatedAt').reverse().toArray()).map(validate); }
export async function updateMemory(id: string, patch: Partial<Omit<DurableMemory, 'id' | 'createdAt'>>): Promise<DurableMemory> {
  const existing = await getMemory(id); if (!existing) throw new Error('Memory not found.');
  const candidate = { ...existing, ...patch };
  const normalized = normalizeMemoryInput({
    kind: candidate.kind, title: candidate.title, body: candidate.body, observedAt: candidate.observedAt,
    confidence: candidate.confidence, importance: candidate.importance, lifecycle: candidate.lifecycle,
    source: normalizeProvenance(candidate.source, candidate.createdAt), tags: candidate.tags,
    relatedMemoryIds: candidate.relatedMemoryIds, supportingMemoryIds: candidate.supportingMemoryIds,
    conflictingMemoryIds: candidate.conflictingMemoryIds, supersedes: candidate.supersedes, supersededBy: candidate.supersededBy,
    folderId: candidate.folderId, expiresAt: candidate.expiresAt,
  }, Date.now());
  return saveExisting(validate({
    ...candidate,
    kind: normalized.kind!, title: normalized.title, body: normalized.body, observedAt: normalized.observedAt!,
    confidence: normalized.confidence!, importance: normalized.importance!, lifecycle: normalized.lifecycle!, source: normalized.source!,
    tags: normalized.tags!, relatedMemoryIds: normalized.relatedMemoryIds!, supportingMemoryIds: normalized.supportingMemoryIds!,
    conflictingMemoryIds: normalized.conflictingMemoryIds!, supersedes: normalized.supersedes!, supersededBy: normalized.supersededBy!,
    folderId: normalized.folderId ?? null, expiresAt: normalized.expiresAt ?? null, updatedAt: Date.now(),
  }));
}
async function saveExisting(record: DurableMemory): Promise<DurableMemory> { const valid = validate(record); await table().put(valid); return valid; }
export async function deleteMemory(id: string): Promise<void> { await table().delete(id); }
export async function countMemories(): Promise<number> { return table().count(); }
export async function archiveMemory(id: string): Promise<DurableMemory> { return updateMemory(id, { lifecycle: 'archived' }); }
export async function reinforceMemory(id: string, confidence?: number, importance?: number): Promise<DurableMemory> {
  const existing = await getMemory(id); if (!existing) throw new Error('Memory not found.');
  return updateMemory(id, { lifecycle: 'active', confidence: confidence === undefined ? existing.confidence : clampUnitInterval(confidence, existing.confidence), importance: importance === undefined ? existing.importance : clampUnitInterval(importance, existing.importance), reinforcementCount: existing.reinforcementCount + 1 });
}
export async function promoteMemory(id: string, targetKind?: MemoryKind): Promise<DurableMemory> {
  const existing = await getMemory(id); if (!existing) throw new Error('Memory not found.');
  const current = PROMOTION_ORDER.indexOf(existing.kind); const requested = targetKind === undefined ? current + 1 : PROMOTION_ORDER.indexOf(targetKind); const nextIndex = Math.max(current, Math.min(PROMOTION_ORDER.length - 1, requested));
  return updateMemory(id, { kind: PROMOTION_ORDER[nextIndex] ?? existing.kind, lifecycle: 'active', reinforcementCount: existing.reinforcementCount + 1 });
}
export async function retrieveMemories(scope: MemoryRetrievalScope = {}): Promise<RetrievedMemory[]> {
  const candidates = await listMemories();
  const selected = rankAndBudgetMemories(candidates, scope);
  if (selected.length) {
    const recalledAt = Date.now();
    for (const memory of selected) await saveExisting({ ...memory, lastRecalledAt: recalledAt, recallCount: memory.recallCount + 1 });
  }
  return selected;
}
export { formatMemoryContext };

void normalizeTitle; void normalizeBody; void normalizeTags; void normalizeIds;
