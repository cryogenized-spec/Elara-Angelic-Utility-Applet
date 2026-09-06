import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { createMemory } from '../persistence/memory';
import { createFolderPath } from '../persistence/folders';
import { appendMemoryContext, loadMemoryContext } from './memory-context';

describe('Gemini durable-memory context boundary', () => {
  beforeEach(async () => {
    await db.memories.clear();
    await db.folderAssignments.clear();
    await db.folders.clear();
    window.localStorage.clear();
  });

  it('formats retrieved memory as contextual application data', () => {
    const result = appendMemoryContext('ELARA MASTER INSTRUCTION', 'Relevant durable memories.\n- [CORE] User prefers concise answers.');
    expect(result).toContain('ELARA MASTER INSTRUCTION');
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(result).toContain('User prefers concise answers.');
  });

  it('includes only active-folder and global memories when a folder is global-scoped', async () => {
    const folder = await createFolderPath('Projects/Elara');
    await db.folderAssignments.put({ id: 'thread-1', threadId: 'thread-1', folderId: folder.id, updatedAt: Date.now() });
    window.localStorage.setItem('elara.active-thread', 'thread-1');
    await db.folders.update(folder.id, { contextScope: 'global' });

    await createMemory({ content: 'Elara project memory', folderId: folder.id, tags: ['project'], confidence: 1, importance: 1 });
    await createMemory({ content: 'Global user preference', folderId: null, tags: ['global'], confidence: 1, importance: 1 });
    const other = await createFolderPath('Other');
    await createMemory({ content: 'Other project secret', folderId: other.id, tags: ['other'], confidence: 1, importance: 1 });

    const context = await loadMemoryContext('project preference');
    expect(context).toContain('Elara project memory');
    expect(context).toContain('Global user preference');
    expect(context).not.toContain('Other project secret');
  });

  it('excludes global memories when the active folder is folder-only', async () => {
    const folder = await createFolderPath('Private');
    await db.folderAssignments.put({ id: 'thread-2', threadId: 'thread-2', folderId: folder.id, updatedAt: Date.now() });
    window.localStorage.setItem('elara.active-thread', 'thread-2');

    await createMemory({ content: 'Private folder note', folderId: folder.id, confidence: 1, importance: 1 });
    await createMemory({ content: 'Global note that must stay out', folderId: null, confidence: 1, importance: 1 });

    const context = await loadMemoryContext('note');
    expect(context).toContain('Private folder note');
    expect(context).not.toContain('Global note that must stay out');
  });
});
