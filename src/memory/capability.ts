import type { DurableMemory, MemoryInput, MemoryKind, MemoryProvenance } from './types';
import { archiveMemory, deleteMemory, saveMemory } from './store';
import { authorizeMemoryMutation, type MemoryActor } from './permissions';

export interface MemorySaveRequest {
  title: string;
  body: string;
  kind?: MemoryKind;
  tags?: string[];
}

export interface MemoryCapabilityContext {
  actor?: MemoryActor;
  conversationId?: string;
  messageId?: string;
  folderId?: string | null;
  provenanceNote?: string;
}

export interface MemoryCapability {
  save(request: MemorySaveRequest, context?: MemoryCapabilityContext): Promise<DurableMemory>;
  forget(id: string, context?: MemoryCapabilityContext): Promise<DurableMemory>;
  delete(id: string, context?: MemoryCapabilityContext): Promise<void>;
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
 * Deliberate application capability for model-requested memory mutation.
 * Authorization is checked here, before storage. The caller supplies memory
 * prose and lightweight classification only; the application owns identity,
 * timestamps, provenance, validation and persistence.
 */
export const memory: MemoryCapability = {
  async save(request, context = {}) {
    authorizeMemoryMutation('save', context);
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

  async forget(id, context = {}) {
    authorizeMemoryMutation('forget', context);
    return archiveMemory(id);
  },

  async delete(id, context = {}) {
    authorizeMemoryMutation('delete', context);
    await deleteMemory(id);
  },
};
