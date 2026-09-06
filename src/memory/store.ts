import type { DurableMemory, MemoryInput } from './types';
import { durableMemorySchema } from './schema';
import { normalizeMemoryInput } from './normalize';
import { createMemoryId } from './ids';
import { db } from '../persistence/conversation';

const MAX_MEMORY_RECORDS_PER_WRITE = 1;

type MemoryTable = {
  put(value: DurableMemory): Promise<unknown>;
  get(key: string): Promise<DurableMemory | undefined>;
  update(key: string, changes: Partial<DurableMemory>): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  orderBy(index: string): { reverse(): { toArray(): Promise<DurableMemory[]> } };
};

function table(): MemoryTable {
  return db.memories as unknown as MemoryTable;
}

function assertRecord(record: DurableMemory): DurableMemory {
  const result = durableMemorySchema.safeParse(record);
  if (!result.success) throw new Error('Invalid durable memory record.');
  return result.data;
}

export async function saveMemory(input: MemoryInput): Promise<DurableMemory> {
  const now = Date.now();
  const normalized = normalizeMemoryInput(input, now);
  const record: DurableMemory = assertRecord({
    id: createMemoryId(),
    kind: normalized.kind!,
    title: normalized.title,
    body: normalized.body,
    createdAt: now,
    updatedAt: now,
    observedAt: normalized.observedAt!,
    confidence: normalized.confidence!,
    importance: normalized.importance!,
    lifecycle: normalized.lifecycle!,
    source: normalized.source!,
    tags: normalized.tags!,
    relatedMemoryIds: normalized.relatedMemoryIds!,
    supportingMemoryIds: normalized.supportingMemoryIds!,
    conflictingMemoryIds: normalized.conflictingMemoryIds!,
    supersedes: normalized.supersedes!,
    supersededBy: normalized.supersededBy!,
    reinforcementCount: 0,
    folderId: normalized.folderId ?? null,
    expiresAt: normalized.expiresAt ?? null,
    lastRecalledAt: null,
    recallCount: 0,
  });
  await table().put(record);
  return record;
}

export async function getMemory(id: string): Promise<DurableMemory | undefined> {
  const record = await table().get(id);
  return record ? assertRecord(record) : undefined;
}

export async function listMemories(): Promise<DurableMemory[]> {
  const records = await table().orderBy('updatedAt').reverse().toArray();
  return records.map(assertRecord);
}

export async function updateMemory(id: string, patch: Partial<Omit<DurableMemory, 'id' | 'createdAt'>>): Promise<DurableMemory> {
  const existing = await getMemory(id);
  if (!existing) throw new Error('Memory not found.');
  const next = assertRecord({ ...existing, ...patch, updatedAt: Date.now() });
  await table().put(next);
  return next;
}

export async function deleteMemory(id: string): Promise<void> {
  await table().delete(id);
}

export async function countMemories(): Promise<number> {
  return db.memories.count();
}

export { MAX_MEMORY_RECORDS_PER_WRITE };
