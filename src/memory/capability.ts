import type { DurableMemory, MemoryInput, MemoryKind, MemoryProvenance } from './types';
import { saveMemory } from './store';

export interface MemorySaveRequest {
  title: string;
  body: string;
  kind?: MemoryKind;
  tags?: string[];
}

export interface MemoryCapabilityContext {
  conversationId?: string;
  messageId?: string;
  folderId?: string | null;
  provenanceNote?: string;
}

export interface MemoryCapability {
  save(request: MemorySaveRequest, context?: MemoryCapabilityContext): Promise<DurableMemory>;
}

function elaraProvenance(context: MemoryCapabilityContext = {}): MemoryProvenance {
  return {
    source: 'elara',
    createdAt: Date.now(),
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}),
    ...(context.provenanceNote ? { note: context.provenanceNote } : {}),
  };
}

/**
 * Deliberate application capability for model-requested memory creation.
 * The caller supplies memory prose and lightweight classification only. The
 * application owns identity, timestamps, provenance, validation and storage.
 */
export const memory: MemoryCapability = {
  async save(request, context = {}) {
    const input: MemoryInput = {
      title: request.title,
      body: request.body,
      kind: request.kind,
      tags: request.tags,
      folderId: context.folderId,
      source: elaraProvenance(context),
    };
    return saveMemory(input);
  },
};
