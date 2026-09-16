import type { GoogleToolHandlers } from '../google/tools/executor';
import { loadFolderState } from '../persistence/folders';
import { memory } from './capability';
import { validateMemoryToolArguments } from './tool-schema';

function requiredIdentity(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 256) throw new Error(`Memory tool ${label} is unavailable.`);
  return normalized;
}

export const memoryToolHandlers: GoogleToolHandlers = {
  'memory.save': async ({ arguments: raw, conversationId, messageId, generationId, callId, signal, isGenerationActive }) => {
    const args = validateMemoryToolArguments('memory.save', raw);
    const boundConversationId = requiredIdentity(conversationId, 'conversation provenance');
    const boundMessageId = requiredIdentity(messageId, 'message provenance');
    const boundGenerationId = requiredIdentity(generationId, 'generation provenance');
    const boundCallId = requiredIdentity(callId, 'call provenance');
    const isMutationAllowed = () => !signal?.aborted && (isGenerationActive?.() ?? true);
    if (!isMutationAllowed()) throw new DOMException('The memory mutation lost turn authority.', 'AbortError');

    const folderState = await loadFolderState();
    const folderId = folderState.assignments[boundConversationId] ?? null;
    if (!isMutationAllowed()) throw new DOMException('The memory mutation lost turn authority.', 'AbortError');

    const record = await memory.save(
      {
        title: args.title,
        body: args.body,
        kind: args.kind ?? 'CONTEXTUAL',
        confidence: args.confidence,
        importance: args.importance,
        tags: args.tags,
      },
      {
        actor: 'model',
        conversationId: boundConversationId,
        messageId: boundMessageId,
        folderId,
        idempotencyKey: `${boundGenerationId}:${boundCallId}`,
        isMutationAllowed,
      },
    );

    return { saved: true, ref: record.id, kind: record.kind };
  },
};
