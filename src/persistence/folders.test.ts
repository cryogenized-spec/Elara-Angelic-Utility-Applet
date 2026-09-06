import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './conversation';
import {
  assignThreadToFolder,
  createFolderPath,
  deleteFolder,
  loadFolderState,
  moveFolder,
  renameFolder,
  setFolderContextScope,
} from './folders';

describe('conversation folder persistence', () => {
  beforeEach(async () => {
    await db.folderAssignments.clear();
    await db.folders.clear();
  });

  it('creates slash paths as durable nested folders', async () => {
    const leaf = await createFolderPath('Projects/Elara/UI');
    const state = await loadFolderState();
    expect(state.folders).toHaveLength(3);
    expect(state.folders.find((folder) => folder.id === leaf.id)?.name).toBe('UI');
    expect(state.folders.find((folder) => folder.name === 'UI')?.parentId).toBe(state.folders.find((folder) => folder.name === 'Elara')?.id);
  });

  it('prevents cycles and duplicate sibling names while moving', async () => {
    const root = await createFolderPath('Projects');
    const child = await createFolderPath('Projects/Elara');
    const other = await createFolderPath('Archive');

    await expect(moveFolder(root.id, child.id)).rejects.toThrow(/cannot be moved/i);
    await moveFolder(child.id, other.id);
    await expect(renameFolder(child.id, 'Projects')).rejects.toThrow(/already exists/i);
  });

  it('promotes children and direct assignments when deleting a folder', async () => {
    const parent = await createFolderPath('Projects');
    const child = await createFolderPath('Projects/Elara');
    await assignThreadToFolder('thread-1', parent.id);
    await assignThreadToFolder('thread-2', child.id);

    await deleteFolder(parent.id);
    const state = await loadFolderState();
    expect(state.folders.find((folder) => folder.id === child.id)?.parentId).toBeNull();
    expect(state.assignments['thread-1']).toBeNull();
    expect(state.assignments['thread-2']).toBe(child.id);
  });

  it('persists folder-only versus global memory scope', async () => {
    const folder = await createFolderPath('Elara');
    await setFolderContextScope(folder.id, 'global');
    const state = await loadFolderState();
    expect(state.folders.find((item) => item.id === folder.id)?.contextScope).toBe('global');
  });
});
