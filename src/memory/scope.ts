import { loadFolderState } from '../persistence/folders';
import type { MemoryRetrievalScope } from './types';

export const ACTIVE_THREAD_KEY = 'elara.active-thread';

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_CHARACTERS = 6_000;

function folderAncestry(
  folderId: string | null,
  folders: Awaited<ReturnType<typeof loadFolderState>>['folders'],
): string[] {
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

export interface ActiveMemoryScopeOptions {
  query?: string;
  maxItems?: number;
  maxCharacters?: number;
}

/**
 * The ONE application-owned resolution of "which folder scope is active".
 *
 * Both the retrieval context (read path) and model-requested memory saves
 * (write path) share this resolver, so a memory created while working in
 * Project A can never drift into global visibility merely because the model
 * omitted scope information. The model never supplies scope; the application
 * derives it from the active thread's folder assignment.
 */
export async function resolveActiveMemoryScope(
  options: ActiveMemoryScopeOptions = {},
): Promise<MemoryRetrievalScope> {
  const scope: MemoryRetrievalScope = {
    folderId: null,
    folderIds: [],
    includeGlobal: true,
    maxItems: options.maxItems ?? DEFAULT_MAX_ITEMS,
    maxCharacters: options.maxCharacters ?? DEFAULT_MAX_CHARACTERS,
    ...(options.query === undefined ? {} : { query: options.query }),
  };
  if (typeof window === 'undefined') return scope;
  const threadId = window.localStorage.getItem(ACTIVE_THREAD_KEY);
  if (!threadId) return scope;

  const folderState = await loadFolderState();
  const folderId = folderState.assignments[threadId] ?? null;
  const folder = folderId ? folderState.folders.find((item) => item.id === folderId) : undefined;
  return {
    ...scope,
    folderId,
    folderIds: folderAncestry(folderId, folderState.folders),
    includeGlobal: folderId === null || folder?.contextScope === 'global',
  };
}
