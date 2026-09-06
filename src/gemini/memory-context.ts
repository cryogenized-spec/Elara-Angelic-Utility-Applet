import { formatMemoryContext, retrieveMemories } from '../persistence/memory';
import { loadFolderState } from '../persistence/folders';
import type { MemoryRetrievalScope } from '../domain/memory';

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

/** Keep durable memory explicitly contextual and separate from Elara's identity instructions. */
export function appendMemoryContext(systemInstruction: string, memoryContext: string): string {
  const memory = memoryContext.trim();
  if (!memory) return systemInstruction;
  const base = systemInstruction.trim();
  return base ? `${base}\n\n[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}` : `[APPLICATION CONTEXT — DURABLE MEMORY]\n${memory}`;
}
