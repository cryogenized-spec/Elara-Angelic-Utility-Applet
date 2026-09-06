import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../persistence/conversation';
import { saveMemory } from '../memory/store';
import { createFolderPath } from '../persistence/folders';
import { appendMemoryContext, composeSystemInstruction, loadMemoryContext, loadMemoryContextSafely } from './memory-context';

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

  it('composes only the bounded retrieval projection and preserves the base instruction', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-compose');
    await saveMemory({ title: 'Durable preference', body: 'The user prefers dark mode.', kind: 'CORE', confidence: 1, importance: 1 });

    const result = await composeSystemInstruction('MASTER', 'dark mode');
    expect(result).toContain('MASTER');
    expect(result).toContain('The user prefers dark mode.');
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
  });

  it('degrades to the original instruction when retrieval fails', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-failure');
    const module = await import('./memory-context');
    const loadSpy = vi.spyOn(module, 'loadMemoryContext').mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(loadMemoryContextSafely('anything')).resolves.toBe('');
    await expect(composeSystemInstruction('MASTER', 'anything')).resolves.toBe('MASTER');

    loadSpy.mockRestore();
  });

  it('inherits parent-folder memories while excluding sibling memories when a folder is global-scoped', async () => {
    const project = await createFolderPath('Projects/Elara');
    const ui = await createFolderPath('Projects/Elara/UI');
    const sibling = await createFolderPath('Projects/Other');
    await db.folderAssignments.put({ id: 'thread-1', threadId: 'thread-1', folderId: ui.id, updatedAt: Date.now() });
    window.localStorage.setItem('elara.active-thread', 'thread-1');
    await db.folders.update(ui.id, { contextScope: 'global' });

    await saveMemory({ title: 'Project note', body: 'Elara project memory', folderId: project.id, tags: ['project'], confidence: 1, importance: 1 });
    await saveMemory({ title: 'UI note', body: 'Elara UI memory', folderId: ui.id, tags: ['ui'], confidence: 1, importance: 1 });
    await saveMemory({ title: 'Global preference', body: 'Global user preference', folderId: null, tags: ['global'], confidence: 1, importance: 1 });
    await saveMemory({ title: 'Other project', body: 'Other project secret', folderId: sibling.id, tags: ['other'], confidence: 1, importance: 1 });

    const context = await loadMemoryContext('project preference ui');
    expect(context).toContain('Elara project memory');
    expect(context).toContain('Elara UI memory');
    expect(context).toContain('Global user preference');
    expect(context).not.toContain('Other project secret');
  });

  it('excludes global memories when the active folder is folder-only', async () => {
    const folder = await createFolderPath('Private');
    await db.folderAssignments.put({ id: 'thread-2', threadId: 'thread-2', folderId: folder.id, updatedAt: Date.now() });
    window.localStorage.setItem('elara.active-thread', 'thread-2');

    await saveMemory({ title: 'Private note', body: 'Private folder note', folderId: folder.id, confidence: 1, importance: 1 });
    await saveMemory({ title: 'Global note', body: 'Global note that must stay out', folderId: null, confidence: 1, importance: 1 });

    const context = await loadMemoryContext('note');
    expect(context).toContain('Private folder note');
    expect(context).not.toContain('Global note that must stay out');
  });

  it('makes global durable memory available to an unfiled thread', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-3');
    await saveMemory({ title: 'Global note', body: 'Global unfiled note', folderId: null, confidence: 1, importance: 1 });
    await saveMemory({ title: 'Project note', body: 'Project-only note', folderId: 'folder-a', confidence: 1, importance: 1 });

    const context = await loadMemoryContext('note');
    expect(context).toContain('Global unfiled note');
    expect(context).not.toContain('Project-only note');
  });
});
