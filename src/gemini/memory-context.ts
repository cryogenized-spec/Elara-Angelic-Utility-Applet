import { memoryScopeForConversation } from '../memory/retrieval';
import { formatMemoryContext, retrieveMemories } from '../memory/store';
import { loadFolderState } from '../persistence/folders';

const ACTIVE_THREAD_KEY = 'elara.active-thread';

function resolveConversationId(conversationId?: string): string | null {
  const captured = conversationId?.trim();
  if (captured) return captured;
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_THREAD_KEY)?.trim() || null;
}

/**
 * Build a bounded, folder-aware durable-memory context for the originating
 * conversation. The active-thread localStorage value is only a compatibility
 * fallback for callers that do not carry turn provenance.
 */
export async function loadMemoryContext(query: string, conversationId?: string): Promise<string> {
  const threadId = resolveConversationId(conversationId);
  if (!threadId) return '';

  const folderState = await loadFolderState();
  return formatMemoryContext(await retrieveMemories(memoryScopeForConversation(threadId, folderState, query)));
}

export type MemoryContextStatus = 'used' | 'empty' | 'unavailable';
export interface MemoryContextResult { context: string; status: MemoryContextStatus; }
export type MemoryContextLoader = (query: string, conversationId?: string) => Promise<string>;

/**
 * Retrieve memory without allowing a local persistence failure to block Gemini.
 * The status is deliberately coarse: UI may report that memory was used or
 * unavailable, but never receives memory contents through this diagnostic path.
 */
export async function loadMemoryContextResult(
  query: string,
  loader: MemoryContextLoader = loadMemoryContext,
  conversationId?: string,
): Promise<MemoryContextResult> {
  try {
    const context = await loader(query, conversationId);
    return { context, status: context.trim() ? 'used' : 'empty' };
  } catch {
    return { context: '', status: 'unavailable' };
  }
}

/** Backwards-compatible string-only helper for existing callers/tests. */
export async function loadMemoryContextSafely(query: string, loader: MemoryContextLoader = loadMemoryContext, conversationId?: string): Promise<string> {
  return (await loadMemoryContextResult(query, loader, conversationId)).context;
}

/** Keep durable memory explicitly contextual and separate from Elara's identity instructions. */
export function appendMemoryContext(systemInstruction: string, memoryContext: string): string {
  const memory = memoryContext.trim();
  if (!memory) return systemInstruction;
  const base = systemInstruction.trim();
  return base ? `${base}\n\n[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}` : `[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}`;
}

export interface ComposedSystemInstruction {
  instruction?: string;
  memoryStatus: MemoryContextStatus;
}

/**
 * Build the final instruction and expose only the retrieval outcome needed by
 * Generation Activity. No durable-memory contents are duplicated into telemetry.
 */
export async function composeSystemInstructionWithStatus(
  systemInstruction: string | undefined,
  query: string,
  conversationId?: string,
): Promise<ComposedSystemInstruction> {
  const memory = await loadMemoryContextResult(query, loadMemoryContext, conversationId);
  const contextual = appendMemoryContext(systemInstruction ?? '', memory.context);
  return { instruction: contextual.trim() ? contextual : undefined, memoryStatus: memory.status };
}

/** Existing string-only API retained for non-trace callers. */
export async function composeSystemInstruction(systemInstruction: string | undefined, query: string, conversationId?: string): Promise<string | undefined> {
  return (await composeSystemInstructionWithStatus(systemInstruction, query, conversationId)).instruction;
}
