import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConversationFolder, FolderContextScope, FolderState } from '../../persistence/folders';
import { assignThreadToFolder, createFolderPath, deleteFolder, loadFolderState, moveFolder, renameFolder, setFolderContextScope } from '../../persistence/folders';

type FolderContextValue = {
  state: FolderState;
  create: (path: string, parentId?: string | null) => ConversationFolder;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  move: (id: string, parentId: string | null) => void;
  assignThread: (threadId: string, folderId: string | null) => void;
  setContextScope: (id: string, scope: FolderContextScope) => void;
};

const FolderContext = createContext<FolderContextValue | null>(null);

export function FolderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FolderState>(() => loadFolderState());

  useEffect(() => {
    const sync = () => setState(loadFolderState());
    window.addEventListener('elara-folders-changed', sync);
    return () => window.removeEventListener('elara-folders-changed', sync);
  }, []);

  const value = useMemo<FolderContextValue>(() => ({
    state,
    create(path, parentId = null) { const folder = createFolderPath(path, parentId); setState(loadFolderState()); return folder; },
    rename(id, name) { renameFolder(id, name); setState(loadFolderState()); },
    remove(id) { deleteFolder(id); setState(loadFolderState()); },
    move(id, parentId) { moveFolder(id, parentId); setState(loadFolderState()); },
    assignThread(threadId, folderId) { assignThreadToFolder(threadId, folderId); setState(loadFolderState()); },
    setContextScope(id, scope) { setFolderContextScope(id, scope); setState(loadFolderState()); },
  }), [state]);

  return <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;
}

export function useFolders(): FolderContextValue {
  const value = useContext(FolderContext);
  if (!value) throw new Error('useFolders must be used within FolderProvider.');
  return value;
}
