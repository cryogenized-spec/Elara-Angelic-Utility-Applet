import type { DurableMemory, MemoryInput, MemoryKind, MemoryProvenance } from './types';
import { archiveMemory, deleteMemory, saveMemory, saveMemoryOnce } from './store';
import { authorizeMemoryMutation, type MemoryActor } from './permissions';

export interface MemorySaveRequest {
  title: string;
  body: string;
  kind?: MemoryKind;
  confidence?: number;
  importance?: number;
  tags?: string[];
}

export interface MemoryCapabilityContext {
  actor?: MemoryActor;
  conversationId?: string;
  messageId?: string;
  folderId?: string | null;
  provenanceNote?: string;
  /** Application-owned replay key. Never model supplied. */
  idempotencyKey?: string;
}

export interface MemoryCapability {
  save(request: MemorySaveRequest, context?: MemoryCapabilityContext): Promise<DurableMemory>;
  forget(id: string, context?: MemoryCapabilityContext): Promise<DurableMemory>;
  delete(id: string, context?: MemoryCapabilityContext): Promise<void>;
}

function effectiveProvenanceNote(context: MemoryCapabilityContext): string | undefined {
  const key = context.idempotencyKey?.trim();
  if (key) return `idempotency:${key.slice(0, 470)}`;
  return context.provenanceNote?.trim() || undefined;
}

function elaraProvenance(context: MemoryCapabilityContext = {}): MemoryProvenance {
  const note = effectiveProvenanceNote(context);
  return {
    source: 'elara',
    createdAt: Date.now(),
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}),
    ...(note ? { note } : {}),
  };
}

export const memory: MemoryCapability = {
  async save(request, context = {}) {
    authorizeMemoryMutation('save', context);
    const source = elaraProvenance(context);
    const input: MemoryInput = {
      title: request.title,
      body: request.body,
      kind: request.kind,
      confidence: request.confidence,
      importance: request.importance,
      tags: request.tags,
      folderId: context.folderId,
      source,
    };
    return context.idempotencyKey ? saveMemoryOnce(input, source.note!) : saveMemory(input);
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
