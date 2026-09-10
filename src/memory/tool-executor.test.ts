import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { createFolderPath } from '../persistence/folders';
import { composeSystemInstruction } from '../gemini/memory-context';
import { resetMemoryPermissionPolicy, setMemoryPermissionPolicy } from './permissions';
import { countMemories, listMemories } from './store';
import { executeMemoryTool } from './tool-executor';

describe('memory.save tool executor', () => {
  beforeEach(async () => {
    await db.memories.clear();
    await db.folderAssignments.clear();
    await db.folders.clear();
    window.localStorage.clear();
    resetMemoryPermissionPolicy();
  });

  it('persists to the canonical Dexie store with Elara provenance and conversation refs', async () => {
    const result = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Cat food routine', body: 'Buys cat food roughly once a week.', kind: 'CONTEXTUAL', tags: ['pets'] } },
      { conversationId: 'thread-cat', messageId: 'msg-1' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deduped).toBe(false);
    expect(result.memoryId).toMatch(/^memory_/);
    expect(await countMemories()).toBe(1);
    const [record] = await listMemories();
    expect(record?.id).toBe(result.memoryId);
    expect(record?.title).toBe('Cat food routine');
    expect(record?.kind).toBe('CONTEXTUAL');
    expect(record?.tags).toEqual(['pets']);
    expect(record?.source).toMatchObject({ source: 'elara', conversationId: 'thread-cat', messageId: 'msg-1' });
    expect(record?.folderId).toBeNull();
  });

  it('never lets the model claim user provenance or application-owned fields', async () => {
    const result = await executeMemoryTool({
      tool: 'memory.save',
      arguments: {
        title: 'Forged note',
        body: 'The model attempts to claim authorship.',
        source: { source: 'user', createdAt: 1 },
        folderId: 'folder-forged',
        id: 'forged-id',
        lifecycle: 'active',
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_MEMORY_REQUEST' });
    expect(await countMemories()).toBe(0);
  });

  it('takes folder scope from the application, never from the model', async () => {
    const project = await createFolderPath('Projects/Elara');
    await db.folderAssignments.put({ id: 'thread-a', threadId: 'thread-a', folderId: project.id, updatedAt: Date.now() });
    window.localStorage.setItem('elara.active-thread', 'thread-a');

    const scoped = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Project note', body: 'Scoped to Project A.' } },
      { conversationId: 'thread-a' },
    );
    expect(scoped.ok).toBe(true);

    window.localStorage.setItem('elara.active-thread', 'thread-unfiled');
    const global = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Global note', body: 'No folder assignment.' } },
      { conversationId: 'thread-unfiled' },
    );
    expect(global.ok).toBe(true);

    const records = await listMemories();
    expect(records.find((record) => record.title === 'Project note')?.folderId).toBe(project.id);
    expect(records.find((record) => record.title === 'Global note')?.folderId).toBeNull();
  });

  it('denies saves through the centralized policy without persisting', async () => {
    setMemoryPermissionPolicy({ model: { save: false } });
    const result = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Blocked', body: 'Policy denies this save.' } },
    );
    expect(result).toMatchObject({ ok: false, code: 'MEMORY_PERMISSION_DENIED' });
    expect(await countMemories()).toBe(0);
  });

  it('rejects observations, empty prose, and oversized data through save', async () => {
    await expect(
      executeMemoryTool({ tool: 'memory.save', arguments: { title: 'T', body: 'B', kind: 'MICRO_OBSERVATION' } }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_MEMORY_REQUEST' });
    await expect(
      executeMemoryTool({ tool: 'memory.save', arguments: { title: '   ', body: 'B' } }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_MEMORY_REQUEST' });
    await expect(
      executeMemoryTool({ tool: 'memory.save', arguments: { title: 'T', body: '' } }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_MEMORY_REQUEST' });
    await expect(
      executeMemoryTool({ tool: 'memory.save', arguments: { title: 'x'.repeat(161), body: 'B' } }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_MEMORY_REQUEST' });
    expect(await countMemories()).toBe(0);
  });

  it('keeps internal memory operations structurally unavailable to the model', async () => {
    setMemoryPermissionPolicy({ model: { forget: true, delete: true } });
    await expect(
      executeMemoryTool({ tool: 'memory.forget', arguments: { title: 'T', body: 'B' } }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    await expect(
      executeMemoryTool({ tool: 'memory.delete', arguments: { title: 'T', body: 'B' } }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    await expect(
      executeMemoryTool({ tool: 'memory.observe', arguments: { title: 'T', body: 'B' } }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    expect(await countMemories()).toBe(0);
  });

  it('returns the existing record instead of duplicating an identical save', async () => {
    const first = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Cat food routine', body: 'Buys cat food roughly once a week.' } },
    );
    expect(first.ok).toBe(true);

    const second = await executeMemoryTool(
      // Same note with different casing/whitespace: already known.
      { tool: 'memory.save', arguments: { title: '  CAT FOOD routine ', body: 'buys  cat food\nroughly once a week.' } },
    );
    expect(second).toMatchObject({ ok: true, deduped: true });
    expect(await countMemories()).toBe(1);
    if (first.ok && second.ok) expect(second.memoryId).toBe(first.memoryId);

    const distinct = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Cat food routine', body: 'Switched to a new brand this month.' } },
    );
    expect(distinct).toMatchObject({ ok: true, deduped: false });
    expect(await countMemories()).toBe(2);
  });

  it('makes a saved memory available to later bounded retrieval', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-later');
    const saved = await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Cat food routine', body: 'Buys cat food roughly once a week.' } },
      { conversationId: 'thread-later' },
    );
    expect(saved.ok).toBe(true);

    const instruction = await composeSystemInstruction('MASTER', 'are we due for cat food?');
    expect(instruction).toContain('MASTER');
    expect(instruction).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(instruction).toContain('Buys cat food roughly once a week.');
  });

  it('never creates durable records merely because retrieval context was composed', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-quiet');
    await executeMemoryTool(
      { tool: 'memory.save', arguments: { title: 'Existing', body: 'An earlier durable note.' } },
      { conversationId: 'thread-quiet' },
    );
    expect(await countMemories()).toBe(1);
    await composeSystemInstruction('MASTER', 'ordinary chatter without a memory decision');
    await composeSystemInstruction('MASTER', 'more ordinary chatter');
    expect(await countMemories()).toBe(1);
  });
});
