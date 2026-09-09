import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_CONTEXT_MAX_BYTES,
  AUTONOMY_CONTEXT_MAX_RECORDS,
  type AutonomyContextSource,
  type AutonomyContextRecord,
  autonomyContextByteSize,
  buildAutonomyContext,
  hashAutonomyContext,
  isAutonomyContextEligible,
  serializeAutonomyContext,
  validateAutonomyContextPack,
} from './context';

const NOW = 1_700_000_000_000;

function makeMemory(overrides: Partial<AutonomyContextSource> = {}): AutonomyContextSource {
  return {
    id: 'memory-1',
    kind: 'CONTEXTUAL',
    title: 'Recurring task',
    body: 'The user reviews tasks every Monday morning.',
    tags: ['tasks'],
    importance: 0.7,
    confidence: 0.8,
    observedAt: NOW - 86_400_000,
    updatedAt: NOW - 3_600_000,
    lifecycle: 'active',
    expiresAt: null,
    autonomyContext: true,
    relatedMemoryIds: [],
    supportingMemoryIds: [],
    conflictingMemoryIds: [],
    reinforcementCount: 0,
    ...overrides,
  };
}

describe('Autonomy Context eligibility (design §8.5)', () => {
  it('consented active CORE/CONTEXTUAL/EPISODIC memories are eligible', () => {
    for (const kind of ['CORE', 'CONTEXTUAL', 'EPISODIC'] as const) {
      expect(isAutonomyContextEligible(makeMemory({ kind }), NOW)).toBe(true);
    }
  });

  it('MICRO_OBSERVATION is never eligible', () => {
    expect(isAutonomyContextEligible(makeMemory({ kind: 'MICRO_OBSERVATION' }), NOW)).toBe(false);
  });

  it('dormant and archived memories never travel', () => {
    expect(isAutonomyContextEligible(makeMemory({ lifecycle: 'dormant' }), NOW)).toBe(false);
    expect(isAutonomyContextEligible(makeMemory({ lifecycle: 'archived' }), NOW)).toBe(false);
  });

  it('expired memories never travel', () => {
    expect(isAutonomyContextEligible(makeMemory({ expiresAt: NOW - 1 }), NOW)).toBe(false);
    expect(isAutonomyContextEligible(makeMemory({ expiresAt: NOW + 1 }), NOW)).toBe(true);
  });

  it('nothing is eligible without the explicit consent flag (default false)', () => {
    expect(isAutonomyContextEligible(makeMemory({ autonomyContext: false }), NOW)).toBe(false);
  });
});

describe('buildAutonomyContext — deterministic bounded projection', () => {
  it('projects exactly the consented, eligible records with bounded fields', async () => {
    const projection = await buildAutonomyContext([makeMemory(), makeMemory({ id: 'memory-2', autonomyContext: false }), makeMemory({ id: 'memory-3', kind: 'MICRO_OBSERVATION' })], NOW);
    expect(projection.recordCount).toBe(1);
    expect(projection.records[0]).toEqual({
      id: 'memory-1',
      kind: 'CONTEXTUAL',
      title: 'Recurring task',
      body: 'The user reviews tasks every Monday morning.',
      tags: ['tasks'],
      importance: 0.7,
      confidence: 0.8,
      observedAt: NOW - 86_400_000,
      updatedAt: NOW - 3_600_000,
    });
    // The projection shape excludes relationship graphs, folders, conversation ids, telemetry.
    expect(Object.keys(projection.records[0]!).sort()).toEqual(['body', 'confidence', 'id', 'importance', 'kind', 'observedAt', 'tags', 'title', 'updatedAt']);
  });

  it('equivalent memory sets produce identical ordering and contentHash (determinism)', async () => {
    const memories = Array.from({ length: 30 }, (_, index) => makeMemory({ id: `memory-${index}`, importance: (index % 10) / 10, updatedAt: NOW - index * 1_000 }));
    const a = await buildAutonomyContext(memories, NOW);
    const shuffled = [...memories].reverse();
    const b = await buildAutonomyContext(shuffled, NOW);
    expect(b.records.map((record) => record.id)).toEqual(a.records.map((record) => record.id));
    expect(b.contentHash).toBe(a.contentHash);
  });

  it('truncates at 200 records and flags the truncation', async () => {
    const memories = Array.from({ length: AUTONOMY_CONTEXT_MAX_RECORDS + 1 }, (_, index) => makeMemory({ id: `memory-${index}` }));
    const projection = await buildAutonomyContext(memories, NOW);
    expect(projection.recordCount).toBe(AUTONOMY_CONTEXT_MAX_RECORDS);
    expect(projection.truncated).toBe(true);
  });

  it('respects the 100 KB serialized budget by dropping the lowest-ranked content deterministically', async () => {
    // High-ranked small memory + many large bodies: the budget keeps the top of the ranking.
    const top = makeMemory({ id: 'memory-top', importance: 1, confidence: 1, body: 'small but important' });
    const large = Array.from({ length: 60 }, (_, index) => makeMemory({ id: `memory-large-${index}`, importance: 0.1, body: 'x'.repeat(4_000) }));
    const projection = await buildAutonomyContext([top, ...large], NOW);
    expect(projection.byteSize).toBeLessThanOrEqual(AUTONOMY_CONTEXT_MAX_BYTES);
    expect(projection.truncated).toBe(true);
    expect(projection.records[0]!.id).toBe('memory-top'); // highest ranked survives first
    // Deterministic: rebuild gives the same truncated set.
    const again = await buildAutonomyContext([top, ...large], NOW);
    expect(again.contentHash).toBe(projection.contentHash);
  });

  it('an empty consent set yields an empty (but valid) projection — graceful degradation, never failure', async () => {
    const projection = await buildAutonomyContext([], NOW);
    expect(projection.recordCount).toBe(0);
    expect(projection.contentHash).toBe(await hashAutonomyContext([]));
  });
});

describe('pack validation — the worker never trusts the browser', () => {
  async function packFor(records: AutonomyContextRecord[], overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return { contentHash: await hashAutonomyContext(records), records, ...overrides };
  }

  it('accepts a client-valid pack and reports its true byte size', async () => {
    const records: AutonomyContextRecord[] = [{
      id: 'memory-1', kind: 'CORE', title: 'Preference', body: 'Prefers concise briefings.', tags: [],
      importance: 0.9, confidence: 0.9, observedAt: NOW, updatedAt: NOW,
    }];
    const pack = await packFor(records);
    const result = await validateAutonomyContextPack(pack);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.byteSize).toBe(autonomyContextByteSize(records));
  });

  it('rejects a malformed pack (unknown fields fail closed)', async () => {
    const records: AutonomyContextRecord[] = [{
      id: 'memory-1', kind: 'CORE', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW,
    }];
    const pack = await packFor(records, { extra: 'smuggled' });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'malformed' });
    expect(await validateAutonomyContextPack({ records: 'nope' })).toEqual({ ok: false, code: 'malformed' });
  });

  it('rejects record fields the projection never carries (folderId, conversationId)', async () => {
    const base = {
      id: 'memory-1', kind: 'CORE', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW,
    };
    const pack = await packFor([], { records: [{ ...base, folderId: 'folder-a' }] });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'malformed' });
  });

  it('rejects an illegal memory kind (MICRO_OBSERVATION)', async () => {
    const base = { id: 'memory-1', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW };
    const pack = await packFor([], { records: [{ ...base, kind: 'MICRO_OBSERVATION' }] });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'malformed' });
  });

  it('rejects more than 200 records', async () => {
    const record = { id: 'm', kind: 'CORE', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW } as const;
    const pack = await packFor([], { records: Array.from({ length: 201 }, (_, index) => ({ ...record, id: `m-${index}` })) });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'too-many-records' });
  });

  it('rejects an oversized pack even under the record cap', async () => {
    const record = (index: number) => ({ id: `m-${index}`, kind: 'CORE', title: 'T', body: 'x'.repeat(4_000), tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW });
    const records = Array.from({ length: 40 }, (_, index) => record(index));
    const pack = await packFor([], { records });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'too-large' });
  });

  it('rejects a hash mismatch — the pack must hash to what it claims', async () => {
    const records: AutonomyContextRecord[] = [{
      id: 'memory-1', kind: 'CORE', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: NOW, updatedAt: NOW,
    }];
    const pack = await packFor(records, { contentHash: '0'.repeat(64) });
    expect(await validateAutonomyContextPack(pack)).toEqual({ ok: false, code: 'hash-mismatch' });
  });

  it('the canonical serialization is stable (fixed field order)', () => {
    const record: AutonomyContextRecord = { id: 'm', kind: 'CORE', title: 'T', body: 'B', tags: ['x'], importance: 0.5, confidence: 0.5, observedAt: 1, updatedAt: 2 };
    expect(serializeAutonomyContext([record])).toBe(JSON.stringify([{ id: 'm', kind: 'CORE', title: 'T', body: 'B', tags: ['x'], importance: 0.5, confidence: 0.5, observedAt: 1, updatedAt: 2 }]));
  });
});
