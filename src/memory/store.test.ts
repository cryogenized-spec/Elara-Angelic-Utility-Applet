import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { archiveMemory, deleteMemory, getMemory, listMemories, promoteMemory, reinforceMemory, retrieveMemories, runMemoryMutationTransaction, saveMemory, saveMemoryOnce, updateMemory } from './store';

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

  it('quarantines malformed rows without disabling valid functional reads', async () => {
    const healthy = await saveMemory({ title: 'Healthy record', body: 'Valid context must remain usable.' });
    await db.memories.put({
      id: 'memory_corrupt',
      title: 'Corrupt row',
      updatedAt: Date.now() + 10_000,
      confidence: 5,
    } as never);

    await expect(listMemories()).resolves.toEqual([expect.objectContaining({ id: healthy.id })]);
    await expect(retrieveMemories({ includeGlobal: true, query: 'valid context' })).resolves.toEqual([
      expect.objectContaining({ id: healthy.id }),
    ]);
  });

  it('saves one logical mutation exactly once and rejects changed replay payloads', async () => {
    const source = { source: 'elara' as const, createdAt: 1_000, conversationId: 'thread_1', messageId: 'message_1', note: 'idempotency:thread_1:message_1:generation_1:call_1' };
    const input = { title: 'Replay-safe memory', body: 'Create this logical memory once.', tags: ['replay'], folderId: 'folder_1', source };

    const first = await saveMemoryOnce(input, source.note);
    const replay = await saveMemoryOnce({ ...input, source: { ...source, createdAt: 2_000 } }, source.note);

    expect(replay.id).toBe(first.id);
    expect(await db.memories.count()).toBe(1);
    await expect(saveMemoryOnce({ ...input, body: 'A changed payload must not borrow the original call identity.' }, source.note))
      .rejects.toThrow('replay does not match the original mutation');
    await expect(saveMemoryOnce({ ...input, tags: ['different-tag'] }, source.note))
      .rejects.toThrow('replay does not match the original mutation');
    expect(await db.memories.count()).toBe(1);
    await expect(saveMemoryOnce(input, '   ')).rejects.toThrow('Memory idempotency provenance is required.');
    await expect(saveMemoryOnce(input, 'idempotency:other-call')).rejects.toThrow('Memory idempotency provenance mismatch.');
  });

  it('allows later relationship changes without invalidating the original save replay', async () => {
    const source = { source: 'elara' as const, createdAt: 1_000, note: 'idempotency:generation_1:call_relationship' };
    const input = { title: 'Relationship-safe replay', body: 'Relationship metadata may evolve later.', source };
    const first = await saveMemoryOnce(input, source.note);
    await updateMemory(first.id, { relatedMemoryIds: ['memory_related_later'] });
    const replay = await saveMemoryOnce({ ...input, source: { ...source, createdAt: 5_000 } }, source.note);
    expect(replay.id).toBe(first.id);
    expect(replay.relatedMemoryIds).toEqual(['memory_related_later']);
  });

  it('aborts a replay-safe save when turn authority is absent before persistence', async () => {
    const source = { source: 'elara' as const, createdAt: 1_000, note: 'idempotency:generation_2:call_1' };
    await expect(saveMemoryOnce(
      { title: 'Cancelled memory', body: 'This must not persist.', source },
      source.note,
      () => false,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(await db.memories.count()).toBe(0);
  });

  it('commits or rolls back a compound mutation as one authority boundary', async () => {
    const committed = await runMemoryMutationTransaction(() => saveMemory({ title: 'Compound success', body: 'This transaction is allowed.' }));
    expect(await getMemory(committed.id)).toBeDefined();
    await deleteMemory(committed.id);

    let checks = 0;
    await expect(runMemoryMutationTransaction(
      () => saveMemory({ title: 'Compound rollback', body: 'This write must be rolled back before commit.' }),
      () => { checks += 1; return checks === 1; },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(await db.memories.count()).toBe(0);
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

  it('keeps manual promotion single-stage and never uses promotion as an implicit restore', async () => {
    const micro = await saveMemory({ kind: 'MICRO_OBSERVATION', title: 'Promotion source', body: 'One stage at a time.' });
    await expect(promoteMemory(micro.id, 'CORE')).rejects.toThrow(/exactly one stage/i);
    expect((await getMemory(micro.id))?.kind).toBe('MICRO_OBSERVATION');
    expect((await getMemory(micro.id))?.reinforcementCount).toBe(0);

    const episodic = await promoteMemory(micro.id, 'EPISODIC');
    expect(episodic.kind).toBe('EPISODIC');
    expect(episodic.reinforcementCount).toBe(1);

    const core = await saveMemory({ kind: 'CORE', title: 'Core memory', body: 'Already at the top.' });
    await expect(promoteMemory(core.id)).rejects.toThrow(/highest kind/i);
    expect((await getMemory(core.id))?.reinforcementCount).toBe(0);

    await archiveMemory(core.id);
    await expect(promoteMemory(core.id)).rejects.toThrow(/restore an archived memory/i);
    expect((await getMemory(core.id))?.lifecycle).toBe('archived');
    expect((await getMemory(core.id))?.reinforcementCount).toBe(0);
  });

  it('updates recall telemetry only for memories selected by relevance policy', async () => {
    const relevant = await saveMemory({ title: 'Mother plans', body: 'The user plans to visit their mother this weekend.' });
    const unrelated = await saveMemory({ title: 'Favorite game', body: 'The user loves elaborate fantasy role-playing games.', kind: 'CORE', importance: 1, confidence: 1, pinned: true });

    const selected = await retrieveMemories({ includeGlobal: true, query: 'mother weekend' });

    expect(selected.map((memory) => memory.id)).toEqual([relevant.id]);
    expect((await getMemory(relevant.id))?.recallCount).toBe(1);
    expect((await getMemory(unrelated.id))?.recallCount).toBe(0);
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