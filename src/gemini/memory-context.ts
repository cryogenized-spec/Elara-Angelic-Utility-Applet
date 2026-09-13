import { formatMemoryContext, retrieveMemories } from '../memory/store';
import { loadFolderState } from '../persistence/folders';
import type { MemoryRetrievalScope } from '../memory/types';

const ACTIVE_THREAD_KEY = 'elara.active-thread';

function folderAncestry(folderId: string | null, folders: Awaited<ReturnType<typeof loadFolderState>>['folders']): string[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) break;
    result.push(folder.id);
    currentId = folder.parentId;
  }
  return result;
}

/** Build a bounded, folder-aware durable-memory context for the current thread. */
export async function loadMemoryContext(query: string): Promise<string> {
  if (typeof window === 'undefined') return '';
  const threadId = window.localStorage.getItem(ACTIVE_THREAD_KEY);
  if (!threadId) return '';

  const folderState = await loadFolderState();
  const folderId = folderState.assignments[threadId] ?? null;
  const folder = folderId ? folderState.folders.find((item) => item.id === folderId) : undefined;
  const inheritedFolderIds = folderAncestry(folderId, folderState.folders);

  const scope: MemoryRetrievalScope = {
    folderId,
    folderIds: inheritedFolderIds,
    includeGlobal: folderId === null || folder?.contextScope === 'global',
    query,
    maxItems: 8,
    maxCharacters: 6_000,
  };
  return formatMemoryContext(await retrieveMemories(scope));
}

export type MemoryContextStatus = 'used' | 'empty' | 'unavailable';
export interface MemoryContextResult { context: string; status: MemoryContextStatus; }

/**
 * Retrieve memory without allowing a local persistence failure to block Gemini.
 * The status is deliberately coarse: UI may report that memory was used or
 * unavailable, but never receives memory contents through this diagnostic path.
 */
export async function loadMemoryContextResult(
  query: string,
  loader: (query: string) => Promise<string> = loadMemoryContext,
): Promise<MemoryContextResult> {
  try {
    const context = await loader(query);
    return { context, status: context.trim() ? 'used' : 'empty' };
  } catch {
    return { context: '', status: 'unavailable' };
  }
}

/** Backwards-compatible string-only helper for existing callers/tests. */
export async function loadMemoryContextSafely(query: string, loader: (query: string) => Promise<string> = loadMemoryContext): Promise<string> {
  return (await loadMemoryContextResult(query, loader)).context;
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
): Promise<ComposedSystemInstruction> {
  const memory = await loadMemoryContextResult(query);
  const contextual = appendMemoryContext(systemInstruction ?? '', memory.context);
  return { instruction: contextual.trim() ? contextual : undefined, memoryStatus: memory.status };
}

/** Existing string-only API retained for non-trace callers. */
export async function composeSystemInstruction(systemInstruction: string | undefined, query: string): Promise<string | undefined> {
  return (await composeSystemInstructionWithStatus(systemInstruction, query)).instruction;
}
