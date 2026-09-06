import type { DurableMemory, MemoryInput, MemoryKind, MemoryRetrievalScope, RetrievedMemory } from '../domain/memory';
import {
  archiveMemory,
  countMemories,
  deleteMemory,
  getMemory,
  listMemories,
  promoteMemory,
  reinforceMemory,
  retrieveMemories,
  saveMemory,
  updateMemory,
  formatMemoryContext,
} from '../memory/store';

export async function createMemory(input: MemoryInput): Promise<DurableMemory> {
  return saveMemory(input);
}

export {
  archiveMemory,
  countMemories,
  deleteMemory,
  getMemory,
  listMemories,
  promoteMemory,
  reinforceMemory,
  retrieveMemories,
  updateMemory,
  formatMemoryContext,
};

export type { MemoryKind, MemoryRetrievalScope, RetrievedMemory };
