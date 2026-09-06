import type { DurableMemory, MemoryKind, MemoryLifecycle } from './types';

export type MemoryInspectionFilter = 'all' | MemoryKind | MemoryLifecycle | 'global';

export function matchesMemoryQuery(memory: DurableMemory, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${memory.title}\n${memory.body}\n${memory.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
}

export function filterMemoryRecords(memories: DurableMemory[], filter: MemoryInspectionFilter = 'all', query = ''): DurableMemory[] {
  return memories.filter((memory) => {
    const matchesFilter = filter === 'all'
      || (filter === 'global' && memory.folderId === null)
      || memory.kind === filter
      || memory.lifecycle === filter;
    return matchesFilter && matchesMemoryQuery(memory, query);
  });
}
