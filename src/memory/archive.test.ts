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
} from './archive';
import { listMemories, saveMemory, updateMemory } from './store';

describe('Memory Bank archive boundary', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('round-trips a strict versioned archive', async () => {
    const memory = await saveMemory({ title: 'Landmark', body: 'A durable landmark.', pinned: true });
    const text = serializeMemoryArchive([memory], 12_345);
    const parsed = parseMemoryArchiveText(text);
    expect(parsed.format).toBe(MEMORY_ARCHIVE_FORMAT);
    expect(parsed.version).toBe(MEMORY_ARCHIVE_VERSION);
    expect(parsed.exportedAt).toBe(12_345);
    expect(parsed.memories[0]).toMatchObject({ id: memory.id, pinned: true, title: 'Landmark' });
  });

  it('imports with fresh IDs, safe scope/provenance, no autonomy consent, and remapped relationships', async () => {
    const first = await saveMemory({ title: 'Canonical truth', body: 'First body.', kind: 'CORE', folderId: 'old-folder', pinned: true, autonomyContext: true });
    const second = await saveMemory({ title: 'Contradictory evidence', body: 'Second body.', folderId: 'old-folder' });
    await updateMemory(first.id, { conflictingMemoryIds: [second.id], reinforcementCount: 7 });
    await updateMemory(second.id, { conflictingMemoryIds: [first.id] });
    const source = await listMemories();
    const archive = createMemoryArchive(source, 20_000);
    const oldIds = new Set(source.map((memory) => memory.id));

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

    const importedFirst = imported.find((memory) => memory.source.note?.endsWith(`:${first.id}`));
    const importedSecond = imported.find((memory) => memory.source.note?.endsWith(`:${second.id}`));
    expect(importedFirst).toBeDefined();
    expect(importedSecond).toBeDefined();
    expect(importedFirst).toMatchObject({ kind: 'CONTEXTUAL', pinned: true });
    expect(importedFirst!.conflictingMemoryIds).toEqual([importedSecond!.id]);
    expect(importedSecond!.conflictingMemoryIds).toEqual([importedFirst!.id]);
  });

  it('rejects malformed or unrecognized archives before any write', async () => {
    const wrongVersion = JSON.stringify({ format: MEMORY_ARCHIVE_FORMAT, version: 2, exportedAt: 1, memories: [] });
    expect(() => parseMemoryArchiveText(wrongVersion)).toThrow('format or records are invalid');
    await expect(importMemoryArchive({ format: MEMORY_ARCHIVE_FORMAT, version: 2, exportedAt: 1, memories: [] })).rejects.toThrow('format or records are invalid');
    expect(await listMemories()).toEqual([]);
  });

  it('rejects oversized archive text before JSON parsing', () => {
    const text = 'x'.repeat(MEMORY_ARCHIVE_MAX_BYTES + 1);
    expect(() => parseMemoryArchiveText(text)).toThrow('exceeds the import size limit');
  });
});