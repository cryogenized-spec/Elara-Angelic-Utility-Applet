import { normalizedEvidenceKey, previewMemoryLifecycleTransition, type MemoryLifecycleReason } from './lifecycle';
import { memoryProvenanceView, type MemoryProvenanceView } from './provenance';
import type { DurableMemory, MemoryKind, MemoryLifecycle } from './types';

export type MemoryInspectionFilter = 'all' | MemoryKind | MemoryLifecycle | 'global' | 'pinned' | `provenance:${MemoryProvenanceView}`;

export interface MemoryLifecycleCandidate {
  id: string;
  title: string;
  fromKind: MemoryKind;
  toKind: MemoryKind;
  fromLifecycle: MemoryLifecycle;
  toLifecycle: MemoryLifecycle;
  reason: MemoryLifecycleReason;
}

export interface MemoryMaintenanceReport {
  reviewed: number;
  duplicateGroups: string[][];
  contradictionClusters: string[][];
  lifecycleCandidates: MemoryLifecycleCandidate[];
}

export function matchesMemoryQuery(memory: DurableMemory, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${memory.title}\n${memory.body}\n${memory.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
}

export function filterMemoryRecords(memories: DurableMemory[], filter: MemoryInspectionFilter = 'all', query = ''): DurableMemory[] {
  return memories.filter((memory) => {
    const matchesFilter = filter === 'all'
      || (filter === 'global' && memory.folderId === null)
      || (filter === 'pinned' && memory.pinned === true)
      || (filter.startsWith('provenance:') && memoryProvenanceView(memory).key === filter.slice('provenance:'.length))
      || memory.kind === filter
      || memory.lifecycle === filter;
    return matchesFilter && matchesMemoryQuery(memory, query);
  });
}

function duplicateSignature(memory: DurableMemory): string {
  const scope = memory.folderId ?? '__global__';
  return `${scope}\u0000${normalizedEvidenceKey(memory.title)}\u0000${normalizedEvidenceKey(memory.body)}`;
}

function duplicateGroups(memories: DurableMemory[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const memory of memories) {
    if (memory.lifecycle === 'archived') continue;
    const key = duplicateSignature(memory);
    const ids = groups.get(key) ?? [];
    ids.push(memory.id);
    groups.set(key, ids);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => [...ids].sort())
    .sort((left, right) => left[0]!.localeCompare(right[0]!));
}

function contradictionClusters(memories: DurableMemory[]): string[][] {
  const eligible = memories.filter((memory) => memory.lifecycle !== 'archived');
  const byId = new Map(eligible.map((memory) => [memory.id, memory]));
  const adjacency = new Map<string, Set<string>>();
  for (const memory of eligible) adjacency.set(memory.id, new Set());
  for (const memory of eligible) {
    for (const conflictId of memory.conflictingMemoryIds) {
      if (!byId.has(conflictId) || conflictId === memory.id) continue;
      adjacency.get(memory.id)!.add(conflictId);
      adjacency.get(conflictId)!.add(memory.id);
    }
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const id of [...byId.keys()].sort()) {
    if (visited.has(id) || adjacency.get(id)!.size === 0) continue;
    const pending = [id];
    const cluster: string[] = [];
    visited.add(id);
    while (pending.length) {
      const current = pending.pop()!;
      cluster.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        pending.push(neighbour);
      }
    }
    if (cluster.length > 1) clusters.push(cluster.sort());
  }
  return clusters.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

/**
 * Read-only deterministic maintenance projection. It never mutates the store,
 * never asks a semantic model to adjudicate history, and never recommends hard
 * deletion. Lifecycle candidates use the exact Phase 4 policy preview consumed
 * by the mutating sweep.
 */
export function buildMemoryMaintenanceReport(memories: DurableMemory[], now = Date.now()): MemoryMaintenanceReport {
  const lifecycleCandidates: MemoryLifecycleCandidate[] = [];
  for (const memory of memories) {
    const transition = previewMemoryLifecycleTransition(memory, now);
    if (!transition) continue;
    lifecycleCandidates.push({
      id: memory.id,
      title: memory.title,
      fromKind: memory.kind,
      toKind: transition.kind,
      fromLifecycle: memory.lifecycle,
      toLifecycle: transition.lifecycle,
      reason: transition.reason,
    });
  }
  lifecycleCandidates.sort((left, right) => left.id.localeCompare(right.id));

  return {
    reviewed: memories.length,
    duplicateGroups: duplicateGroups(memories),
    contradictionClusters: contradictionClusters(memories),
    lifecycleCandidates,
  };
}