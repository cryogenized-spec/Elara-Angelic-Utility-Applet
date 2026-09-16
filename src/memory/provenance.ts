import type { DurableMemory, MemoryProvenance, MemorySource } from './types';

export function userProvenance(now = Date.now(), note?: string): MemoryProvenance {
  return { source: 'user', createdAt: now, ...(note?.trim() ? { note: note.trim() } : {}) };
}

export function elaraProvenance(now = Date.now(), conversationId?: string, messageId?: string, note?: string): MemoryProvenance {
  return {
    source: 'elara',
    createdAt: now,
    ...(conversationId?.trim() ? { conversationId: conversationId.trim() } : {}),
    ...(messageId?.trim() ? { messageId: messageId.trim() } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
}

export function sourceLabel(source: MemorySource): string {
  switch (source) {
    case 'user': return 'User';
    case 'elara': return 'Elara';
    case 'import': return 'Import';
    case 'migration': return 'Migration';
  }
}

export const MEMORY_PROVENANCE_VIEWS = ['explicit-user', 'observed-user-evidence', 'elara-managed', 'imported', 'migrated'] as const;
export type MemoryProvenanceView = (typeof MEMORY_PROVENANCE_VIEWS)[number];

/**
 * Human-facing provenance is derived from canonical source metadata and tags.
 * Organic observations are labelled as user evidence because the classifier is
 * allowed to select only exact spans from a persisted user message; `elara`
 * describes the application writer, not the factual origin of that evidence.
 */
export function memoryProvenanceView(memory: DurableMemory): { key: MemoryProvenanceView; label: string } {
  if (memory.source.source === 'user') return { key: 'explicit-user', label: 'Explicit user memory' };
  if (memory.source.source === 'elara' && memory.tags.includes('organic')) return { key: 'observed-user-evidence', label: 'Observed from user message' };
  if (memory.source.source === 'elara') return { key: 'elara-managed', label: 'Elara-managed memory' };
  if (memory.source.source === 'import') return { key: 'imported', label: 'Imported archive' };
  return { key: 'migrated', label: 'Migrated memory' };
}