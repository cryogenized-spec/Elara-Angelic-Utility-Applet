import { describe, expect, it } from 'vitest';
import { rankAndBudgetMemories } from './retrieval';
import type { DurableMemory } from './types';

const makeMemory = (overrides: Partial<DurableMemory>): DurableMemory => ({
  id: 'memory_test', kind: 'CONTEXTUAL', title: 'Memory', body: 'Useful durable context.',
  createdAt: 1_000, updatedAt: 1_000, observedAt: 1_000, confidence: 0.5, importance: 0.5,
  lifecycle: 'active', source: { source: 'user', createdAt: 1_000 }, tags: [],
  relatedMemoryIds: [], supportingMemoryIds: [], conflictingMemoryIds: [], supersedes: [], supersededBy: [],
  reinforcementCount: 0, folderId: null, expiresAt: null, lastRecalledAt: null, recallCount: 0,
  ...overrides,
});

describe('canonical memory retrieval engine', () => {
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

  it('hard-limits selected records and payload characters', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'a', title: 'A', body: '12345' }),
      makeMemory({ id: 'b', title: 'B', body: '67890' }),
      makeMemory({ id: 'c', title: 'C', body: 'abcdef' }),
    ], { maxItems: 2, maxCharacters: 12 });
    expect(result).toHaveLength(2);
    expect(result.reduce((sum, memory) => sum + memory.title.length + memory.body.length, 0)).toBeLessThanOrEqual(12);
  });

  it('excludes archived, expired, and out-of-scope records', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'active', folderId: 'folder-a' }),
      makeMemory({ id: 'archived', lifecycle: 'archived', folderId: 'folder-a' }),
      makeMemory({ id: 'expired', folderId: 'folder-a', expiresAt: 5_000 }),
      makeMemory({ id: 'other', folderId: 'folder-b' }),
      makeMemory({ id: 'global', folderId: null, kind: 'CORE' }),
    ], { folderId: 'folder-a', includeGlobal: false, now: 10_000 });
    expect(result.map((memory) => memory.id)).toEqual(['active']);
  });

  it('keeps global memories opt-in when a folder is selected', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'folder', folderId: 'folder-a', body: 'Folder fact.' }),
      makeMemory({ id: 'global', folderId: null, kind: 'CORE', body: 'Global fact.' }),
    ], { folderId: 'folder-a', includeGlobal: true, query: 'fact' });
    expect(result.map((memory) => memory.id)).toContain('global');
    expect(result.map((memory) => memory.id)).toContain('folder');
  });
});
