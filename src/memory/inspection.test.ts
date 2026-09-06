import { describe, expect, it } from 'vitest';
import type { DurableMemory } from './types';
import { filterMemoryRecords, matchesMemoryQuery } from './inspection';

const makeMemory = (overrides: Partial<DurableMemory>): DurableMemory => ({
  id: 'memory_test', kind: 'CONTEXTUAL', title: 'Project note', body: 'Elara project context.',
  createdAt: 1_000, updatedAt: 1_000, observedAt: 1_000, confidence: 0.8, importance: 0.6,
  lifecycle: 'active', source: { source: 'user', createdAt: 1_000 }, tags: ['project'],
  relatedMemoryIds: [], supportingMemoryIds: [], conflictingMemoryIds: [], supersedes: [], supersededBy: [],
  reinforcementCount: 0, folderId: 'folder-a', expiresAt: null, lastRecalledAt: null, recallCount: 0,
  ...overrides,
});

describe('Memory Bank inspection projection', () => {
  it('matches title, body, and tags case-insensitively', () => {
    const memory = makeMemory({ title: 'Preferred Theme', tags: ['dark-mode'] });
    expect(matchesMemoryQuery(memory, 'DARK-MODE')).toBe(true);
    expect(matchesMemoryQuery(memory, 'missing')).toBe(false);
    expect(matchesMemoryQuery(memory, '  ')).toBe(true);
  });

  it('filters without changing the canonical records', () => {
    const memories = [
      makeMemory({ id: 'active', folderId: 'folder-a' }),
      makeMemory({ id: 'global', folderId: null, kind: 'CORE' }),
      makeMemory({ id: 'archived', lifecycle: 'archived' }),
      makeMemory({ id: 'observation', kind: 'MICRO_OBSERVATION', body: 'A small observed detail.' }),
    ];

    expect(filterMemoryRecords(memories, 'global').map((item) => item.id)).toEqual(['global']);
    expect(filterMemoryRecords(memories, 'archived').map((item) => item.id)).toEqual(['archived']);
    expect(filterMemoryRecords(memories, 'MICRO_OBSERVATION').map((item) => item.id)).toEqual(['observation']);
    expect(filterMemoryRecords(memories, 'all', 'observed detail').map((item) => item.id)).toEqual(['observation']);
  });
});
