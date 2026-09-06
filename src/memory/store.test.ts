import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { archiveMemory, deleteMemory, getMemory, promoteMemory, reinforceMemory, retrieveMemories, saveMemory, updateMemory } from './store';

describe('canonical durable memory store', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('stores a rich memory document', async () => {
    const now = Date.now() - 1000;
    const memory = await saveMemory({
      kind: 'MICRO_OBSERVATION',
      title: 'Identity note',
      body: 'The character has a stable identity.\n\nMarkdown remains valid stored text.',
      observedAt: now,
      confidence: 0.9,
      importance: 0.95,
      tags: ['identity', 'character'],
      source: { source: 'user', createdAt: now, note: 'Explicit configuration' },
      supportingMemoryIds: ['memory_supporting'],
      relatedMemoryIds: ['memory_related'],
      conflictingMemoryIds: ['memory_conflict'],
      supersedes: ['memory_old'],
    });
    expect(memory.id).toMatch(/^memory_/);
    expect(memory.title).toBe('Identity note');
    expect(memory.body).toContain('Markdown');
    expect(memory.source.source).toBe('user');
    expect(memory.relatedMemoryIds).toEqual(['memory_related']);
    expect(memory.supportingMemoryIds).toEqual(['memory_supporting']);
    expect(memory.conflictingMemoryIds).toEqual(['memory_conflict']);
    expect(memory.supersedes).toEqual(['memory_old']);
    expect(memory.reinforcementCount).toBe(0);
    expect(memory.recallCount).toBe(0);
  });

  it('validates and normalizes title, body, and tags', async () => {
    const memory = await saveMemory({ title: '  Preference  ', body: '  Keep this exact prose.  ', tags: [' Preference ', 'preference'] });
    expect(memory.title).toBe('Preference');
    expect(memory.body).toBe('Keep this exact prose.');
    expect(memory.tags).toEqual(['preference']);
    await expect(saveMemory({ title: '', body: 'Missing title' })).rejects.toThrow('Memory title is required.');
    await expect(saveMemory({ title: 'Missing body', body: '   ' })).rejects.toThrow('Memory body is required.');
  });

  it('updates, reinforces, promotes, archives, and deletes', async () => {
    const memory = await saveMemory({ kind: 'MICRO_OBSERVATION', title: 'First note', body: 'Initial note.' });
    const updated = await updateMemory(memory.id, { title: 'Updated note', body: 'Updated note body.', importance: 1.4 });
    expect(updated.title).toBe('Updated note');
    expect(updated.importance).toBe(1);
    const promoted = await promoteMemory(memory.id);
    expect(promoted.kind).toBe('EPISODIC');
    expect(promoted.reinforcementCount).toBe(1);
    const reinforced = await reinforceMemory(memory.id);
    expect(reinforced.reinforcementCount).toBe(2);
    const archived = await archiveMemory(memory.id);
    expect(archived.lifecycle).toBe('archived');
    await deleteMemory(memory.id);
    expect(await getMemory(memory.id)).toBeUndefined();
  });

  it('keeps folder scope isolated and global scope explicit', async () => {
    await saveMemory({ title: 'Folder A', body: 'A folder-only fact', folderId: 'folder-a' });
    await saveMemory({ title: 'Folder B', body: 'A different-folder fact', folderId: 'folder-b' });
    await saveMemory({ title: 'Global', body: 'A global fact', kind: 'CORE', folderId: null });
    const folderOnly = await retrieveMemories({ folderId: 'folder-a', includeGlobal: false, query: 'fact' });
    expect(folderOnly.map((memory) => memory.body)).toEqual(['A folder-only fact']);
    const withGlobal = await retrieveMemories({ folderId: 'folder-a', includeGlobal: true, query: 'fact' });
    expect(withGlobal.map((memory) => memory.body)).toContain('A global fact');
    expect(withGlobal.map((memory) => memory.body)).not.toContain('A different-folder fact');
  });
});
