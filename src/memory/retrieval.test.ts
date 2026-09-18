import { describe, expect, it } from 'vitest';
import type { FolderState } from '../persistence/folders';
import { formatMemoryContext, isMemoryRetrievable, memoryScopeForConversation, rankAndBudgetMemories } from './retrieval';
import type { DurableMemory } from './types';

const makeMemory = (overrides: Partial<DurableMemory>): DurableMemory => ({
  id: 'memory_test', kind: 'CONTEXTUAL', title: 'Memory', body: 'Useful durable context.',
  createdAt: 1_000, updatedAt: 1_000, observedAt: 1_000, confidence: 0.5, importance: 0.5,
  lifecycle: 'active', source: { source: 'user', createdAt: 1_000 }, tags: [],
  relatedMemoryIds: [], supportingMemoryIds: [], conflictingMemoryIds: [], supersedes: [], supersededBy: [],
  reinforcementCount: 0, folderId: null, expiresAt: null, lastRecalledAt: null, recallCount: 0, pinned: false, autonomyContext: false,
  ...overrides,
});

describe('canonical memory retrieval engine', () => {
  it('derives folder ancestry and global scope from the conversation assignment', () => {
    const state: FolderState = {
      folders: [
        { id: 'parent', name: 'Parent', parentId: null, contextScope: 'folder', createdAt: 1, updatedAt: 1 },
        { id: 'child', name: 'Child', parentId: 'parent', contextScope: 'global', createdAt: 1, updatedAt: 1 },
      ],
      assignments: { thread: 'child' },
    };
    expect(memoryScopeForConversation('thread', state, 'preference')).toEqual({
      folderId: 'child',
      folderIds: ['child', 'parent'],
      includeGlobal: true,
      query: 'preference',
      maxItems: 8,
      maxCharacters: 6_000,
    });
    expect(memoryScopeForConversation('unassigned', state, '')).toMatchObject({ folderId: null, folderIds: [], includeGlobal: true });
  });

  it('ranks lexical relevance ahead of generic recency', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'relevant', title: 'Dark mode preference', body: 'The user prefers dark mode.', updatedAt: 1_000 }),
      makeMemory({ id: 'recent', title: 'Unrelated note', body: 'A different topic entirely.', updatedAt: 9_000 }),
    ], { query: 'dark mode', now: 10_000 });
    expect(result[0]?.id).toBe('relevant');
  });

  it('uses reinforcement and importance as bounded secondary relevance signals', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'reinforced', title: 'Project note', body: 'Project context.', reinforcementCount: 8, importance: 0.9 }),
      makeMemory({ id: 'weak', title: 'Project note', body: 'Project context.', reinforcementCount: 0, importance: 0.1 }),
    ], { query: 'project' });
    expect(result[0]?.id).toBe('reinforced');
  });

  it('treats a pinned landmark as bounded salience without bypassing eligibility', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'ordinary', title: 'Project note', body: 'Project context.' }),
      makeMemory({ id: 'landmark', title: 'Project note', body: 'Project context.', pinned: true }),
      makeMemory({ id: 'archived-landmark', title: 'Project note', body: 'Project context.', pinned: true, lifecycle: 'archived' }),
    ], { query: 'project', includeGlobal: true, now: 10_000 });
    expect(result[0]?.id).toBe('landmark');
    expect(result.map((memory) => memory.id)).not.toContain('archived-landmark');
  });

  it('hard-limits selected records and payload characters', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'a', title: 'A', body: '12345' }),
      makeMemory({ id: 'b', title: 'B', body: '67890' }),
      makeMemory({ id: 'c', title: 'C', body: 'abcdef' }),
    ], { maxItems: 2, maxCharacters: 12 });
    expect(result).toHaveLength(2);
    expect(result.reduce((sum, memory) => sum + memory.title.length + memory.body.length, 0)).toBeLessThanOrEqual(12);
  });

  it('recalls an oversized high-ranked record as a bounded visible excerpt instead of skipping it forever', () => {
    const canonicalBody = `critical project context ${'x'.repeat(9_000)}`;
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'oversized', title: 'Critical project', body: canonicalBody, importance: 1, confidence: 1 }),
    ], { query: 'critical project', maxCharacters: 6_000 });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('oversized');
    expect(result[0]?.body).not.toBe(canonicalBody);
    expect(result[0]?.body.endsWith('…')).toBe(true);
    expect((result[0]?.title.length ?? 0) + (result[0]?.body.length ?? 0)).toBeLessThanOrEqual(6_000);
  });

  it('excludes archived, expired, superseded, dormant micro-evidence, and out-of-scope records', () => {
    const scope = { folderId: 'folder-a', includeGlobal: false, now: 10_000 };
    const active = makeMemory({ id: 'active', folderId: 'folder-a' });
    const archived = makeMemory({ id: 'archived', lifecycle: 'archived', folderId: 'folder-a' });
    const expired = makeMemory({ id: 'expired', folderId: 'folder-a', expiresAt: 5_000 });
    const superseded = makeMemory({ id: 'superseded', folderId: 'folder-a', lifecycle: 'dormant', supersededBy: ['replacement'] });
    const dormantMicro = makeMemory({ id: 'support-evidence', folderId: 'folder-a', kind: 'MICRO_OBSERVATION', lifecycle: 'dormant' });
    const other = makeMemory({ id: 'other', folderId: 'folder-b' });
    const global = makeMemory({ id: 'global', folderId: null, kind: 'CORE' });
    const result = rankAndBudgetMemories([active, archived, expired, superseded, dormantMicro, other, global], scope);
    expect(result.map((memory) => memory.id)).toEqual(['active']);
    expect(isMemoryRetrievable(active, scope)).toBe(true);
    expect(isMemoryRetrievable(archived, scope)).toBe(false);
    expect(isMemoryRetrievable(expired, scope)).toBe(false);
    expect(isMemoryRetrievable(superseded, scope)).toBe(false);
    expect(isMemoryRetrievable(dormantMicro, scope)).toBe(false);
    expect(isMemoryRetrievable(other, scope)).toBe(false);
    expect(isMemoryRetrievable(global, scope)).toBe(false);
  });

  it('keeps dormant established memory recallable with an explicit context label', () => {
    const memory = {
      ...makeMemory({ id: 'conflicted', lifecycle: 'dormant', conflictingMemoryIds: ['secret-internal-id'] }),
      score: 1,
    };
    expect(isMemoryRetrievable(memory, { includeGlobal: true })).toBe(true);
    const context = formatMemoryContext([memory]);
    expect(context).toContain('[CONTEXTUAL; dormant; unresolved-conflict]');
    expect(context).not.toContain('secret-internal-id');
  });

  it('keeps global memories opt-in when a folder is selected', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'folder', folderId: 'folder-a', body: 'Folder fact.' }),
      makeMemory({ id: 'global', folderId: null, kind: 'CORE', body: 'Global fact.' }),
    ], { folderId: 'folder-a', includeGlobal: true, query: 'fact' });
    expect(result.map((memory) => memory.id)).toContain('global');
    expect(result.map((memory) => memory.id)).toContain('folder');
  });

  it('handles a multi-thousand-record candidate set with deterministic budgeting', () => {
    const memories = Array.from({ length: 5_000 }, (_, index) => makeMemory({
      id: `memory_${index}`,
      title: index % 250 === 0 ? `Target project ${index}` : `Record ${index}`,
      body: index % 250 === 0 ? 'Important project context for retrieval stress coverage.' : 'Generic durable context.',
      updatedAt: 10_000 + index,
      folderId: index % 2 === 0 ? 'folder-a' : 'folder-b',
      importance: index % 250 === 0 ? 0.9 : 0.4,
    }));
    const result = rankAndBudgetMemories(memories, {
      folderId: 'folder-a',
      includeGlobal: false,
      query: 'target project',
      maxItems: 8,
      maxCharacters: 6_000,
      now: 20_000,
    });

    expect(result).toHaveLength(8);
    expect(new Set(result.map((memory) => memory.id)).size).toBe(8);
    expect(result.every((memory) => memory.folderId === 'folder-a')).toBe(true);
    expect(result[0]?.title).toContain('Target project');
    expect(result.reduce((sum, memory) => sum + memory.title.length + memory.body.length, 0)).toBeLessThanOrEqual(6_000);
  });
});