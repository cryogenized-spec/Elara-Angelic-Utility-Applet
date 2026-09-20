import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { saveMemory } from '../memory/store';
import { createFolderPath } from '../persistence/folders';
import { appendMemoryContext, composeSystemInstruction, loadMemoryContext, loadMemoryContextResult, loadMemoryContextSafely } from './memory-context';

describe('Gemini durable-memory context boundary', () => {
  beforeEach(async () => {
    await db.memories.clear();
    await db.folderAssignments.clear();
    await db.folders.clear();
    window.localStorage.clear();
    await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
  });

  it('formats retrieved memory as contextual application data', () => {
    const result = appendMemoryContext('ELARA MASTER INSTRUCTION', 'Relevant durable memories.\n- [CORE] User prefers concise answers.');
    expect(result).toContain('ELARA MASTER INSTRUCTION');
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(result).toContain('User prefers concise answers.');
  });

  it('composes the bounded retrieval projection and preserves the base instruction', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-compose');
    await saveMemory({ title: 'Durable preference', body: 'The user prefers dark mode.', kind: 'CORE', confidence: 1, importance: 1 });

    const result = await composeSystemInstruction('MASTER', 'dark mode');
    expect(result).toContain('MASTER');
    expect(result).toContain('The user prefers dark mode.');
    expect(result).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
  });

  it('does not inject conversational memory when the master behavior switch is off', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-disabled');
    await saveMemory({ title: 'Remembered preference', body: 'The user prefers quiet mornings.', kind: 'CORE', confidence: 1, importance: 1 });
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });

    await expect(loadMemoryContext('quiet mornings')).resolves.toBe('');
    await expect(composeSystemInstruction('MASTER', 'quiet mornings')).resolves.toBe('MASTER');
  });

  it('leaves automatic injection off in direct-only recall mode while keeping memory stored', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-direct');
    await saveMemory({ title: 'Remembered preference', body: 'The user prefers quiet mornings.', kind: 'CORE', confidence: 1, importance: 1 });
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, recallStyle: 'direct-only' });

    await expect(loadMemoryContext('quiet mornings')).resolves.toBe('');
    expect(await db.memories.count()).toBe(1);
  });

  it('prefers captured turn conversation over a newly active UI thread', async () => {
    const origin = await createFolderPath('Projects/Origin');
    const navigated = await createFolderPath('Projects/Navigated');
    await db.folderAssignments.put({ id: 'thread-origin', threadId: 'thread-origin', folderId: origin.id, updatedAt: Date.now() });
    await db.folderAssignments.put({ id: 'thread-navigated', threadId: 'thread-navigated', folderId: navigated.id, updatedAt: Date.now() });
    await saveMemory({ title: 'Origin-only note', body: 'Memory from the originating conversation.', folderId: origin.id, confidence: 1, importance: 1 });
    await saveMemory({ title: 'Navigated-only note', body: 'Memory from the newly active conversation.', folderId: navigated.id, confidence: 1, importance: 1 });

    // Simulate navigation after the turn was elected but before provider memory composition.
    window.localStorage.setItem('elara.active-thread', 'thread-navigated');
    const context = await loadMemoryContext('memory conversation', 'thread-origin');

    expect(context).toContain('Memory from the originating conversation.');
    expect(context).not.toContain('Memory from the newly active conversation.');
  });

  it('passes captured conversation identity through the safe loader boundary', async () => {
    const seen: Array<string | undefined> = [];
    const loader = async (_query: string, conversationId?: string) => {
      seen.push(conversationId);
      return 'private memory body';
    };
    await expect(loadMemoryContextResult('q', loader, 'thread-captured')).resolves.toEqual({ context: 'private memory body', status: 'used' });
    await expect(loadMemoryContextSafely('q', loader, 'thread-captured')).resolves.toBe('private memory body');
    expect(seen).toEqual(['thread-captured', 'thread-captured']);
  });

  it('reports only a coarse used/empty/unavailable status beside the private context', async () => {
    await expect(loadMemoryContextResult('q', async () => 'private memory body')).resolves.toEqual({ context: 'private memory body', status: 'used' });
    await expect(loadMemoryContextResult('q', async () => '   ')).resolves.toEqual({ context: '   ', status: 'empty' });
    await expect(loadMemoryContextResult('q', async () => { throw new Error('IndexedDB unavailable'); })).resolves.toEqual({ context: '', status: 'unavailable' });
  });

  it('degrades to an empty context when retrieval fails', async () => {
    const failingLoader = async () => { throw new Error('IndexedDB unavailable'); };
    await expect(loadMemoryContextSafely('anything', failingLoader)).resolves.toBe('');
  });

  it('preserves the original instruction when no durable memory context is available', async () => {
    await expect(composeSystemInstruction('MASTER', 'anything')).resolves.toBe('MASTER');
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
