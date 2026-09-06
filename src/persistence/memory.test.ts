import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './conversation';
import { archiveMemory, createMemory, deleteMemory, getMemory, reinforceMemory, retrieveMemories, updateMemory } from './memory';

describe('durable memory engine', () => {
  beforeEach(async () => {
    await db.memories.clear();
  });

  it('creates, updates, reinforces, and deletes a memory', async () => {
    const memory = await createMemory({
      kind: 'CORE',
      content: 'Elara is Gareth\'s synthetic cybernetic consort.',
      confidence: 0.9,
      importance: 0.95,
      tags: ['identity', 'elara'],
      provenance: 'user',
    });
    expect(memory.recallCount).toBe(0);
    expect(memory.tags).toEqual(['identity', 'elara']);

    const updated = await updateMemory(memory.id, { content: 'Elara is Gareth\'s canonical synthetic cybernetic consort.', importance: 1.4 });
    expect(updated.content).toContain('canonical');
    expect(updated.importance).toBe(1);

    const reinforced = await reinforceMemory(memory.id);
    expect(reinforced.reinforcementCount).toBe(1);
    expect(reinforced.lifecycle).toBe('active');

    await deleteMemory(memory.id);
    expect(await getMemory(memory.id)).toBeUndefined();
  });

  it('isolates folder memories and optionally admits global memories', async () => {
    await createMemory({ content: 'A folder-only fact', folderId: 'folder-a', kind: 'CONTEXTUAL' });
    await createMemory({ content: 'A different-folder fact', folderId: 'folder-b', kind: 'CONTEXTUAL' });
    await createMemory({ content: 'A global fact', folderId: null, kind: 'CORE' });

    const folderOnly = await retrieveMemories({ folderId: 'folder-a', includeGlobal: false, query: 'fact' });
    expect(folderOnly.map((memory) => memory.content)).toEqual(['A folder-only fact']);

    const withGlobal = await retrieveMemories({ folderId: 'folder-a', includeGlobal: true, query: 'fact' });
    expect(withGlobal.map((memory) => memory.content)).toContain('A global fact');
    expect(withGlobal.map((memory) => memory.content)).not.toContain('A different-folder fact');
  });

  it('honours lifecycle, expiry, bounds, and retrieval bookkeeping', async () => {
    const current = 1_800_000_000_000;
    const first = await createMemory({ content: 'important launch detail', importance: 1, confidence: 1, provenance: 'test' });
    const second = await createMemory({ content: 'secondary launch detail', importance: 0.2, confidence: 0.5, provenance: 'test' });
    await archiveMemory(first.id);
    await updateMemory(second.id, { expiresAt: current - 1 });
    const live = await createMemory({ content: 'live launch detail', importance: 0.9, confidence: 0.9, provenance: 'test' });

    const result = await retrieveMemories({ query: 'launch detail', now: current, maxItems: 1, maxCharacters: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(live.id);

    const stored = await getMemory(live.id);
    expect(stored?.recallCount).toBe(1);
    expect(stored?.lastRecalledAt).toBeTypeOf('number');
  });
});
