import { db } from '../persistence/conversation';
import { durableMemorySchema } from './schema';

export interface MemoryStoreHealth {
  total: number;
  valid: number;
  invalid: number;
  invalidIds: string[];
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
    if (!result.success) {
      const candidate = record as Partial<{ id: unknown }>;
      if (typeof candidate.id === 'string' && candidate.id.trim()) invalidIds.push(candidate.id);
      else invalidIds.push('<unknown>');
    }
  }

  return {
    total: records.length,
    valid: records.length - invalidIds.length,
    invalid: invalidIds.length,
    invalidIds,
  };
}
