import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConversationFolder, FolderContextScope, FolderState } from '../../persistence/folders';
import { assignThreadToFolder, createFolderPath, deleteFolder, loadFolderState, moveFolder, renameFolder, setFolderContextScope } from '../../persistence/folders';

type FolderContextValue = {
  state: FolderState;
  ready: boolean;
  create: (path: string, parentId?: string | null) => Promise<ConversationFolder>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, parentId: string | null) => Promise<void>;
  assignThread: (threadId: string, folderId: string | null) => Promise<void>;
  setContextScope: (id: string, scope: FolderContextScope) => Promise<void>;
};

const emptyState: FolderState = { folders: [], assignments: {} };
const FolderContext = createContext<FolderContextValue | null>(null);

export function FolderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FolderState>(emptyState);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setState(await loadFolderState());
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => { void refresh(); };
    window.addEventListener('elara-folders-changed', sync);
    return () => window.removeEventListener('elara-folders-changed', sync);
  }, [refresh]);

  const value = useMemo<FolderContextValue>(() => ({
    state,
    ready,
    async create(path, parentId = null) { const folder = await createFolderPath(path, parentId); await refresh(); return folder; },
    async rename(id, name) { await renameFolder(id, name); await refresh(); },
    async remove(id) { await deleteFolder(id); await refresh(); },
    async move(id, parentId) { await moveFolder(id, parentId); await refresh(); },
    async assignThread(threadId, folderId) { await assignThreadToFolder(threadId, folderId); await refresh(); },
    async setContextScope(id, scope) { await setFolderContextScope(id, scope); await refresh(); },
  }), [ready, refresh, state]);

  return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

export function useFolders(): FolderContextValue {
  const value = useContext(FolderContext);
  if (!value) throw new Error('useFolders must be used within FolderProvider.');
  return value;
}
