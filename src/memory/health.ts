import { db } from '../persistence/conversation';
import { durableMemorySchema } from './schema';

export interface MemoryStoreHealth {
  total: number;
  valid: number;
  invalid: number;
  invalidIds: string[];
}

export function normalizeInvalidMemoryId(record: unknown): string {
  if (record && typeof record === 'object') {
    const candidate = record as Partial<{ id: unknown }>;
    if (typeof candidate.id === 'string' && candidate.id.trim()) return candidate.id;
  }
  return '<unknown>';
}

/**
 * Read-only integrity scan for the canonical durable memory table.
 * Invalid records are reported, never silently rewritten or deleted.
 */
export async function inspectMemoryStore(): Promise<MemoryStoreHealth> {
  const records = await db.memories.toArray();
  const invalidIds: string[] = [];

  for (const record of records) {
    const result = durableMemorySchema.safeParse(record);
    if (!result.success) invalidIds.push(normalizeInvalidMemoryId(record));
  }

  return {
    total: records.length,
    valid: records.length - invalidIds.length,
    invalid: invalidIds.length,
    invalidIds,
  };
}

/**
 * Human-invoked recovery for a row that failed the canonical schema. This is
 * deliberately incapable of deleting a valid memory: callers must identify a
 * concrete invalid primary key and the row is revalidated immediately before
 * deletion.
 */
export async function deleteInvalidMemoryRecord(id: string): Promise<void> {
  const normalized = id.trim();
  if (!normalized || normalized === '<unknown>') throw new Error('A concrete invalid memory id is required.');

  await db.transaction('rw', db.memories, async () => {
    const record = await db.memories.get(normalized);
    if (!record) throw new Error('Invalid memory record was not found.');
    if (durableMemorySchema.safeParse(record).success) throw new Error('Valid memory records cannot be removed by corruption repair.');
    await db.memories.delete(normalized);
  });
}