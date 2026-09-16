import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import {
  createMemoryArchive,
  importMemoryArchive,
  MEMORY_ARCHIVE_FORMAT,
  MEMORY_ARCHIVE_MAX_BYTES,
  MEMORY_ARCHIVE_VERSION,
  parseMemoryArchiveText,
  serializeMemoryArchive,
  type MemoryArchive,
} from './archive';
import { listMemories, saveMemory, updateMemory } from './store';

describe('Memory Bank archive boundary', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('exports a strict portable archive without canonical authority metadata', async () => {
    const memory = await saveMemory({
      title: 'Landmark',
      body: 'A durable landmark.',
      pinned: true,
      folderId: 'private-folder-id',
      autonomyContext: true,
      source: {
        source: 'user',
        createdAt: 1_000,
        conversationId: 'private-conversation-id',
        messageId: 'private-message-id',
        note: 'private-provenance-note',
      },
    });

    const text = serializeMemoryArchive([memory], 12_345);
    const parsed = parseMemoryArchiveText(text);
    const record = parsed.memories[0]!;

    expect(parsed.format).toBe(MEMORY_ARCHIVE_FORMAT);
    expect(parsed.version).toBe(MEMORY_ARCHIVE_VERSION);
    expect(parsed.exportedAt).toBe(12_345);
    expect(record).toMatchObject({ archiveId: 'memory-1', pinned: true, title: 'Landmark', originSource: 'user' });
    expect(text).not.toContain(memory.id);
    expect(text).not.toContain('private-folder-id');
    expect(text).not.toContain('private-conversation-id');
    expect(text).not.toContain('private-message-id');
    expect(text).not.toContain('private-provenance-note');
    expect(record).not.toHaveProperty('autonomyContext');
    expect(record).not.toHaveProperty('recallCount');
    expect(record).not.toHaveProperty('folderId');
  });

  it('imports with fresh IDs, safe scope/provenance, no autonomy consent, and remapped relationships', async () => {
    const first = await saveMemory({ title: 'Canonical truth', body: 'First body.', kind: 'CORE', folderId: 'old-folder', pinned: true, autonomyContext: true });
    const second = await saveMemory({ title: 'Contradictory evidence', body: 'Second body.', folderId: 'old-folder' });
    await updateMemory(first.id, { conflictingMemoryIds: [second.id], reinforcementCount: 7 });
    await updateMemory(second.id, { conflictingMemoryIds: [first.id] });
    const source = await listMemories();
    const archive = createMemoryArchive(source, 20_000);
    const oldIds = new Set(source.map((memory) => memory.id));

    expect(JSON.stringify(archive)).not.toContain(first.id);
    expect(JSON.stringify(archive)).not.toContain(second.id);
    expect(archive.memories.flatMap((memory) => memory.conflicting)).toHaveLength(2);

    await db.memories.clear();
    const result = await importMemoryArchive(archive, { folderId: 'reviewed-folder' });
    expect(result).toMatchObject({ imported: 2, coreDemoted: 1, relationshipLinksRestored: 2 });

    const imported = await listMemories();
    expect(imported).toHaveLength(2);
    expect(imported.every((memory) => !oldIds.has(memory.id))).toBe(true);
    expect(imported.every((memory) => memory.folderId === 'reviewed-folder')).toBe(true);
    expect(imported.every((memory) => memory.source.source === 'import')).toBe(true);
    expect(imported.every((memory) => memory.autonomyContext === false)).toBe(true);
    expect(imported.every((memory) => memory.reinforcementCount === 0)).toBe(true);

    const importedFirst = imported.find((memory) => memory.title === first.title);
    const importedSecond = imported.find((memory) => memory.title === second.title);
    expect(importedFirst).toBeDefined();
    expect(importedSecond).toBeDefined();
    expect(importedFirst).toMatchObject({ kind: 'CONTEXTUAL', pinned: true });
    expect(importedFirst!.conflictingMemoryIds).toEqual([importedSecond!.id]);
    expect(importedSecond!.conflictingMemoryIds).toEqual([importedFirst!.id]);
    expect(importedFirst!.source.note ?? '').not.toContain(first.id);
  });

  it('rejects malformed or unrecognized archives before any write', async () => {
    const wrongVersion = JSON.stringify({ format: MEMORY_ARCHIVE_FORMAT, version: 2, exportedAt: 1, memories: [] });
    expect(() => parseMemoryArchiveText(wrongVersion)).toThrow('format or records are invalid');
    await expect(importMemoryArchive({ format: MEMORY_ARCHIVE_FORMAT, version: 2, exportedAt: 1, memories: [] })).rejects.toThrow('format or records are invalid');
    expect(await listMemories()).toEqual([]);
  });

  it('rejects duplicate or dangling archive relationship authority before any write', async () => {
    await saveMemory({ title: 'First', body: 'First body.' });
    await saveMemory({ title: 'Second', body: 'Second body.' });
    const archive = createMemoryArchive(await listMemories(), 10_000);
    await db.memories.clear();

    const duplicate = JSON.parse(JSON.stringify(archive)) as MemoryArchive;
    duplicate.memories[1]!.archiveId = duplicate.memories[0]!.archiveId;
    await expect(importMemoryArchive(duplicate)).rejects.toThrow('format or records are invalid');
    expect(await listMemories()).toEqual([]);

    const dangling = JSON.parse(JSON.stringify(archive)) as MemoryArchive;
    dangling.memories[0]!.related = ['missing-archive-record'];
    await expect(importMemoryArchive(dangling)).rejects.toThrow('format or records are invalid');
    expect(await listMemories()).toEqual([]);
  });

  it('rejects oversized archive text before JSON parsing', () => {
    const text = 'x'.repeat(MEMORY_ARCHIVE_MAX_BYTES + 1);
    expect(() => parseMemoryArchiveText(text)).toThrow('exceeds the import size limit');
  });

  it('applies the same byte ceiling to already-parsed import values', async () => {
    const oversized: unknown = {
      format: MEMORY_ARCHIVE_FORMAT,
      version: MEMORY_ARCHIVE_VERSION,
      exportedAt: 1,
      memories: [],
      padding: 'x'.repeat(MEMORY_ARCHIVE_MAX_BYTES),
    };
    await expect(importMemoryArchive(oversized)).rejects.toThrow('exceeds the import size limit');
    expect(await listMemories()).toEqual([]);
  });
});
