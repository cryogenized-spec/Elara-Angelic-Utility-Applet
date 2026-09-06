import type { MemoryProvenance, MemorySource } from './types';

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
