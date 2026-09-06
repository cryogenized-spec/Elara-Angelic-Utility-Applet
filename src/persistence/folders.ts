export type FolderContextScope = 'folder' | 'global';

export interface ConversationFolder {
  id: string;
  name: string;
  parentId: string | null;
  contextScope: FolderContextScope;
  createdAt: number;
  updatedAt: number;
}

export interface FolderState {
  folders: ConversationFolder[];
  assignments: Record<string, string | null>;
}

const STORAGE_KEY = 'elara.conversation-folders.v1';
const MAX_FOLDER_NAME = 80;

function sanitizeName(name: string): string {
  return name.trim().replace(/\\/g, '/').replace(/\/+/g, ' ').slice(0, MAX_FOLDER_NAME).trim();
}

function now(): number {
  return Date.now();
}

function readState(): FolderState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], assignments: {} };
    const parsed = JSON.parse(raw) as Partial<FolderState>;
    const folders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is ConversationFolder => {
      return !!folder && typeof folder === 'object' && typeof folder.id === 'string' && typeof folder.name === 'string' && (typeof folder.parentId === 'string' || folder.parentId === null) && (folder.contextScope === 'folder' || folder.contextScope === 'global') && typeof folder.createdAt === 'number' && typeof folder.updatedAt === 'number';
    }) : [];
    const assignments = parsed.assignments && typeof parsed.assignments === 'object' ? Object.fromEntries(Object.entries(parsed.assignments).filter(([threadId, folderId]) => typeof threadId === 'string' && (typeof folderId === 'string' || folderId === null))) : {};
    return repairState({ folders, assignments });
  } catch {
    return { folders: [], assignments: {} };
  }
}

function repairState(state: FolderState): FolderState {
  const ids = new Set(state.folders.map((folder) => folder.id));
  const folders = state.folders.map((folder) => ({ ...folder, parentId: folder.parentId && ids.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null }));
  const assignments = Object.fromEntries(Object.entries(state.assignments).map(([threadId, folderId]) => [threadId, folderId && ids.has(folderId) ? folderId : null]));
  return { folders, assignments };
}

function writeState(state: FolderState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function loadFolderState(): FolderState {
  return readState();
}

export function createFolderPath(path: string, parentId: string | null = null): ConversationFolder {
  const segments = path.split('/').map(sanitizeName).filter(Boolean).slice(0, 12);
  if (!segments.length) throw new Error('Folder name is required.');
  const state = readState();
  let currentParent = parentId;
  let currentFolder: ConversationFolder | undefined;
  for (const segment of segments) {
    const existing = state.folders.find((folder) => folder.parentId === currentParent && folder.name.toLocaleLowerCase() === segment.toLocaleLowerCase());
    if (existing) {
      currentFolder = existing;
      currentParent = existing.id;
      continue;
    }
    const timestamp = now();
    currentFolder = { id: crypto.randomUUID(), name: segment, parentId: currentParent, contextScope: 'folder', createdAt: timestamp, updatedAt: timestamp };
    state.folders.push(currentFolder);
    currentParent = currentFolder.id;
  }
  writeState(state);
  return currentFolder!;
}

export function renameFolder(folderId: string, name: string): void {
  const cleaned = sanitizeName(name);
  if (!cleaned || cleaned.includes('/')) throw new Error('Folder name must be a single path segment.');
  const state = readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  if (state.folders.some((item) => item.id !== folderId && item.parentId === folder.parentId && item.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase())) throw new Error('A folder with that name already exists here.');
  folder.name = cleaned;
  folder.updatedAt = now();
  writeState(state);
}

export function setFolderContextScope(folderId: string, contextScope: FolderContextScope): void {
  const state = readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  folder.contextScope = contextScope;
  folder.updatedAt = now();
  writeState(state);
}

export function moveFolder(folderId: string, parentId: string | null): void {
  const state = readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Folder not found.');
  const blocked = descendants(state, folderId);
  if (parentId !== null && (!state.folders.some((item) => item.id === parentId) || blocked.has(parentId))) throw new Error('That folder cannot be moved there.');
  const siblingNameTaken = state.folders.some((item) => item.id !== folderId && item.parentId === parentId && item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase());
  if (siblingNameTaken) throw new Error('A folder with that name already exists at the destination.');
  folder.parentId = parentId;
  folder.updatedAt = now();
  writeState(state);
}

export function deleteFolder(folderId: string): void {
  const state = readState();
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  for (const child of state.folders) {
    if (child.parentId === folderId) {
      child.parentId = folder.parentId;
      child.updatedAt = now();
    }
  }
  for (const [threadId, assignedFolderId] of Object.entries(state.assignments)) {
    if (assignedFolderId === folderId) state.assignments[threadId] = folder.parentId;
  }
  state.folders = state.folders.filter((item) => item.id !== folderId);
  writeState(state);
}

export function assignThreadToFolder(threadId: string, folderId: string | null): void {
  const state = readState();
  if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) throw new Error('Folder not found.');
  state.assignments[threadId] = folderId;
  writeState(state);
}
