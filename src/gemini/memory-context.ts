import { formatMemoryContext, retrieveMemories } from '../persistence/memory';
import { loadFolderState } from '../persistence/folders';
import type { MemoryRetrievalScope } from '../domain/memory';

const ACTIVE_THREAD_KEY = 'elara.active-thread';

/** Build a bounded, folder-aware durable-memory context for the current thread. */
export async function loadMemoryContext(query: string): Promise<string> {
  if (typeof window === 'undefined') return '';
  const threadId = window.localStorage.getItem(ACTIVE_THREAD_KEY);
  if (!threadId) return '';

  const folderState = await loadFolderState();
  const folderId = folderState.assignments[threadId] ?? null;
  const folder = folderId ? folderState.folders.find((item) => item.id === folderId) : undefined;

  const scope: MemoryRetrievalScope = {
    folderId,
    includeGlobal: folder?.contextScope === 'global',
    query,
    maxItems: 8,
    maxCharacters: 6_000,
  };
  return formatMemoryContext(await retrieveMemories(scope));
}

/** Keep durable memory explicitly contextual and separate from Elara's identity instructions. */
export function appendMemoryContext(systemInstruction: string, memoryContext: string): string {
  const memory = memoryContext.trim();
  if (!memory) return systemInstruction;
  return `${systemInstruction.trim()}\n\n[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}`;
}
