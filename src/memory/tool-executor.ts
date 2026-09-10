import { memory } from './capability';
import { isMemoryToolName, memorySaveToolArgsSchema, memoryToolRegistry } from './gemini-tool';
import type { MemoryToolName } from './gemini-tool';
import { authorizeMemoryMutation } from './permissions';
import { rankAndBudgetMemories } from './retrieval';
import { resolveActiveMemoryScope } from './scope';
import { listMemories } from './store';
import type { MemoryKind } from './types';

export interface MemoryToolCall {
  tool: MemoryToolName;
  arguments: Record<string, unknown>;
}

export interface MemoryToolExecutionContext {
  conversationId?: string;
  messageId?: string;
}

export type MemoryToolExecutionResult =
  | { ok: true; memoryId: string; title: string; kind: MemoryKind; deduped: boolean }
  | {
      ok: false;
      code: 'NOT_PERMITTED' | 'INVALID_MEMORY_REQUEST' | 'MEMORY_PERMISSION_DENIED' | 'MEMORY_STORAGE_FAILED';
      message: string;
    };

function normalizeDuplicateKey(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Capability adapter between a Gemini memory tool call and the canonical
 * memory store.
 *
 * MODEL PROPOSES → APPLICATION ADMITS → DURABLE STORE: the model supplies
 * only semantic prose; this adapter owns exposure checks, strict schema
 * validation, permission checks, scope injection, provenance injection,
 * duplicate resilience, and normalization (via the canonical store).
 *
 * The adapter never throws to the tool loop: every outcome is a structured
 * result the loop can feed back to Gemini.
 */
export async function executeMemoryTool(
  call: MemoryToolCall,
  context: MemoryToolExecutionContext = {},
): Promise<MemoryToolExecutionResult> {
  if (!isMemoryToolName(call.tool)) {
    return { ok: false, code: 'NOT_PERMITTED', message: 'Unknown memory tool.' };
  }
  const descriptor = memoryToolRegistry.find((entry) => entry.name === call.tool);
  if (!descriptor || descriptor.exposure !== 'gemini') {
    return { ok: false, code: 'NOT_PERMITTED', message: 'That memory operation is not available to the model.' };
  }

  const parsed = memorySaveToolArgsSchema.safeParse(call.arguments);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_MEMORY_REQUEST', message: 'The memory request was missing required prose or used unsupported fields.' };
  }

  try {
    authorizeMemoryMutation(descriptor.permission, { actor: 'model' });
  } catch {
    return { ok: false, code: 'MEMORY_PERMISSION_DENIED', message: 'The model is not permitted to save memories.' };
  }

  try {
    // Duplicate resilience through the EXISTING retrieval boundary: look for
    // the same note inside the currently visible scope before persisting.
    // The pure selector is used directly so a write-path lookup never
    // pollutes recall bookkeeping.
    const scope = await resolveActiveMemoryScope({
      query: `${parsed.data.title} ${parsed.data.body}`,
      maxItems: 20,
      maxCharacters: 20_000,
    });
    const visible = rankAndBudgetMemories(await listMemories(), scope);
    const titleKey = normalizeDuplicateKey(parsed.data.title);
    const bodyKey = normalizeDuplicateKey(parsed.data.body);
    const duplicate = visible.find(
      (candidate) =>
        normalizeDuplicateKey(candidate.title) === titleKey && normalizeDuplicateKey(candidate.body) === bodyKey,
    );
    if (duplicate) {
      return { ok: true, memoryId: duplicate.id, title: duplicate.title, kind: duplicate.kind, deduped: true };
    }

    const record = await memory.save(
      { title: parsed.data.title, body: parsed.data.body, kind: parsed.data.kind, tags: parsed.data.tags },
      {
        actor: 'model',
        conversationId: context.conversationId,
        messageId: context.messageId,
        folderId: scope.folderId ?? null,
      },
    );
    return { ok: true, memoryId: record.id, title: record.title, kind: record.kind, deduped: false };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The memory could not be stored.';
    if (message.startsWith('Memory permission denied')) {
      return { ok: false, code: 'MEMORY_PERMISSION_DENIED', message: 'The model is not permitted to save memories.' };
    }
    if (/^Memory (title|body|tag)/.test(message) || message === 'Invalid durable memory record.') {
      return { ok: false, code: 'INVALID_MEMORY_REQUEST', message };
    }
    return { ok: false, code: 'MEMORY_STORAGE_FAILED', message: 'The memory could not be stored.' };
  }
}
