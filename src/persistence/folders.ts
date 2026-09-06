import { db, type StoredConversationFolder, type StoredFolderAssignment } from './conversation';

export type FolderContextScope = 'folder' | 'global';

export interface ConversationFolder extends StoredConversationFolder {
  contextScope: FolderContextScope;
}

export interface FolderState {
  folders: ConversationFolder[];
  assignments: Record<string, string | null>;
}

const MAX_FOLDER_NAME = 80;

function sanitizeName(name: string): string {
  return name.trim().replace(/\\/g, '/').replace(/\/+/g, ' ').slice(0, MAX_FOLDER_NAME).trim();
}

function normalizeFolder(folder: StoredConversationFolder): ConversationFolder {
  return {
    ...folder,
    contextScope: folder.contextScope === 'global' ? 'global' : 'folder',
  };
}

async function readState(): Promise<FolderState> {
  const [folders, assignments] = await Promise.all([
    db.folders.orderBy('updatedAt').toArray(),
    db.folderAssignments.toArray(),
  ]);
  return repairState({
    folders: folders.map(normalizeFolder),
    assignments: Object.fromEntries(assignments.map((assignment) => [assignment.threadId, assignment.folderId])),
  });
}

function repairState(state: FolderState): FolderState {
  const ids = new Set(state.folders.map((folder) => folder.id));
  const folders = state.folders.map((folder) => ({
    ...folder,
    parentId: folder.parentId && ids.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null,
  }));
  const assignments = Object.fromEntries(
    Object.entries(state.assignments).map(([threadId, folderId]) => [threadId, folderId && ids.has(folderId) ? folderId : null]),
  );
  return { folders, assignments };
}

function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent('elara-folders-changed'));
}

function descendants(state: FolderState, folderId: string): Set<string> {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export async function loadFolderState(): Promise<FolderState> {
  return readState();
}

export async function createFolderPath(path: string, parentId: string | null = null): Promise<ConversationFolder> {
  const segments = path.split('/').map(sanitizeName).filter(Boolean).slice(0, 12);
  if (!segments.length) throw new Error('Folder name is required.');
  const state = await readState();
  let currentParent = parentId;
  let currentFolder: ConversationFolder | undefined;
  for (const segment of segments) {
    const existing = state.folders.find((folder) => folder.parentId === currentParent && folder.name.toLocaleLowerCase() === segment.toLocaleLowerCase());
    if (existing) {
      currentFolder = existing;
      currentParent = existing.id;
      continue;
    }
    const timestamp = Date.now();
    currentFolder = { id: crypto.randomUUID(), name: segment, parentId: currentParent, contextScope: 'folder', createdAt: timestamp, updatedAt: timestamp };
    state.folders.push(currentFolder);
    currentParent = currentFolder.id;
  }
  if (!currentFolder) throw new Error('Folder creation failed.');
  await db.transaction('rw', db.folders, async () => {
    await db.folders.bulkPut(state.folders);
  });
  notifyChanged();
  return currentFolder;
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  const cleaned = sanitizeName(name);
  if (!cleaned || cleaned.includes('/')) throw new Error('Folder name must be a single path segment.');
  const state = await readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  if (state.folders.some((item) => item.id !== folderId && item.parentId === folder.parentId && item.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase())) throw new Error('A folder with that name already exists here.');
  folder.name = cleaned;
  folder.updatedAt = Date.now();
  await db.folders.put(folder);
  notifyChanged();
}

export async function setFolderContextScope(folderId: string, contextScope: FolderContextScope): Promise<void> {
  const state = await readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  folder.contextScope = contextScope;
  folder.updatedAt = Date.now();
  await db.folders.put(folder);
  notifyChanged();
}

export async function moveFolder(folderId: string, parentId: string | null): Promise<void> {
  const state = await readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  const blocked = descendants(state, folderId);
  if (parentId !== null && (!state.folders.some((item) => item.id === parentId) || blocked.has(parentId))) throw new Error('That folder cannot be moved there.');
  const siblingNameTaken = state.folders.some((item) => item.id !== folderId && item.parentId === parentId && item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase());
  if (siblingNameTaken) throw new Error('A folder with that name already exists at the destination.');
  folder.parentId = parentId;
  folder.updatedAt = Date.now();
  await db.folders.put(folder);
  notifyChanged();
}

export async function deleteFolder(folderId: string): Promise<void> {
  const state = await readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  for (const child of state.folders) {
    if (child.parentId === folderId) {
      child.parentId = folder.parentId;
      child.updatedAt = Date.now();
    }
  }
  const assignments = Object.entries(state.assignments).filter(([, assignedFolderId]) => assignedFolderId === folderId);
  await db.transaction('rw', db.folders, db.folderAssignments, async () => {
    await db.folders.bulkPut(state.folders.filter((item) => item.id !== folderId));
    if (assignments.length) {
      await db.folderAssignments.bulkPut(assignments.map(([threadId]) => ({ id: threadId, threadId, folderId: folder.parentId, updatedAt: Date.now() }) satisfies StoredFolderAssignment));
    }
    await db.folderAssignments.where('folderId').equals(folderId).delete();
  });
  notifyChanged();
}

export async function assignThreadToFolder(threadId: string, folderId: string | null): Promise<void> {
  if (folderId !== null && !(await db.folders.get(folderId))) throw new Error('Folder not found.');
  await db.folderAssignments.put({ id: threadId, threadId, folderId, updatedAt: Date.now() });
  notifyChanged();
}
