import type { DurableMemory, MemoryInput, MemoryKind, MemoryProvenance } from './types';
import { saveMemory } from './store';

/**
 * Application-owned input for a deliberate memory save request.
 * The caller supplies meaningful memory content; the application owns provenance.
 */
export interface MemorySaveRequest {
  title: string;
  body: string;
  kind?: MemoryKind;
  observedAt?: number;
  confidence?: number;
  importance?: number;
  tags?: string[];
  relatedMemoryIds?: string[];
  supportingMemoryIds?: string[];
  conflictingMemoryIds?: string[];
  supersedes?: string[];
  supersededBy?: string[];
  folderId?: string | null;
  expiresAt?: number | null;
  conversationId?: string;
  messageId?: string;
  provenanceNote?: string;
}

export interface MemoryCapability {
  save(request: MemorySaveRequest): Promise<DurableMemory>;
}

function elaraProvenance(request: MemorySaveRequest): MemoryProvenance {
  return {
    source: 'elara',
    createdAt: Date.now(),
    ...(request.conversationId ? { conversationId: request.conversationId } : {}),
    ...(request.messageId ? { messageId: request.messageId } : {}),
    ...(request.provenanceNote ? { note: request.provenanceNote } : {}),
  };
}

/**
 * Deliberate application capability for model-requested memory creation.
 * No raw Dexie access, caller-controlled identity, timestamps, or source type
 * are exposed at this boundary.
 */
export const memory: MemoryCapability = {
  async save(request) {
    const input: MemoryInput = {
      title: request.title,
      body: request.body,
      kind: request.kind,
      observedAt: request.observedAt,
      confidence: request.confidence,
      importance: request.importance,
      tags: request.tags,
      relatedMemoryIds: request.relatedMemoryIds,
      supportingMemoryIds: request.supportingMemoryIds,
      conflictingMemoryIds: request.conflictingMemoryIds,
      supersedes: request.supersedes,
      supersededBy: request.supersededBy,
      folderId: request.folderId,
      expiresAt: request.expiresAt,
      source: elaraProvenance(request),
    };
    return saveMemory(input);
  },
};
