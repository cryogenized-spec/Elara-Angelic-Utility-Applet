import { describe, expect, it } from 'vitest';
import type { DurableMemory } from './types';
import { buildMemoryMaintenanceReport, filterMemoryRecords, matchesMemoryQuery } from './inspection';
import { ORGANIC_MICRO_DORMANCY_MS } from './lifecycle';

const makeMemory = (overrides: Partial<DurableMemory>): DurableMemory => ({
  id: 'memory_test', kind: 'CONTEXTUAL', title: 'Project note', body: 'Elara project context.',
  createdAt: 1_000, updatedAt: 1_000, observedAt: 1_000, confidence: 0.8, importance: 0.6,
  lifecycle: 'active', source: { source: 'user', createdAt: 1_000 }, tags: ['project'],
  relatedMemoryIds: [], supportingMemoryIds: [], conflictingMemoryIds: [], supersedes: [], supersededBy: [],
  reinforcementCount: 0, folderId: 'folder-a', expiresAt: null, lastRecalledAt: null, recallCount: 0, pinned: false, autonomyContext: false,
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
      makeMemory({ id: 'observation', kind: 'MICRO_OBSERVATION', body: 'A small observed detail.', source: { source: 'elara', createdAt: 1_000 }, tags: ['organic'] }),
      makeMemory({ id: 'landmark', pinned: true }),
    ];

    expect(filterMemoryRecords(memories, 'global').map((item) => item.id)).toEqual(['global']);
    expect(filterMemoryRecords(memories, 'archived').map((item) => item.id)).toEqual(['archived']);
    expect(filterMemoryRecords(memories, 'MICRO_OBSERVATION').map((item) => item.id)).toEqual(['observation']);
    expect(filterMemoryRecords(memories, 'pinned').map((item) => item.id)).toEqual(['landmark']);
    expect(filterMemoryRecords(memories, 'provenance:observed-user-evidence').map((item) => item.id)).toEqual(['observation']);
    expect(filterMemoryRecords(memories, 'all', 'observed detail').map((item) => item.id)).toEqual(['observation']);
  });

  it('builds duplicate and contradiction review groups without mutating records', () => {
    const a = makeMemory({ id: 'a', title: 'Same fact', body: 'I prefer dark mode', conflictingMemoryIds: ['c'] });
    const b = makeMemory({ id: 'b', title: ' same FACT ', body: 'I   PREFER dark mode' });
    const c = makeMemory({ id: 'c', title: 'Contradiction', body: 'I prefer light mode', conflictingMemoryIds: ['a'] });
    const archivedDuplicate = makeMemory({ id: 'd', title: 'Same fact', body: 'I prefer dark mode', lifecycle: 'archived' });
    const snapshot = JSON.stringify([a, b, c, archivedDuplicate]);

    const report = buildMemoryMaintenanceReport([a, b, c, archivedDuplicate], 2_000);
    expect(report.duplicateGroups).toEqual([['a', 'b']]);
    expect(report.contradictionClusters).toEqual([['a', 'c']]);
    expect(JSON.stringify([a, b, c, archivedDuplicate])).toBe(snapshot);
  });

  it('uses the canonical lifecycle preview for maintenance candidates', () => {
    const now = 10_000;
    const stale = makeMemory({
      id: 'stale',
      kind: 'MICRO_OBSERVATION',
      tags: ['organic', 'domain:recurring_context'],
      updatedAt: now - ORGANIC_MICRO_DORMANCY_MS - 1,
      reinforcementCount: 0,
    });
    const promotable = makeMemory({
      id: 'promotable',
      kind: 'MICRO_OBSERVATION',
      confidence: 0.7,
      reinforcementCount: 1,
      supportingMemoryIds: ['support'],
      tags: ['organic', 'domain:preference'],
    });

    const report = buildMemoryMaintenanceReport([stale, promotable], now);
    expect(report.lifecycleCandidates).toEqual([
      expect.objectContaining({ id: 'promotable', toKind: 'EPISODIC', reason: 'promote-episodic' }),
      expect.objectContaining({ id: 'stale', toLifecycle: 'dormant', reason: 'stale-organic' }),
    ]);
  });
});