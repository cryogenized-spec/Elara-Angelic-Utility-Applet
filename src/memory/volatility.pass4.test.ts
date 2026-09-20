import { describe, expect, it } from 'vitest';
import type { DurableMemory } from './types';
import { previewMemoryLifecycleTransition } from './lifecycle';
import { deriveMemoryVolatility, deriveProvenanceClass, hasOperationalStateHint } from './volatility';

/**
 * Companion continuity Pass 4 — provenance, volatility and
 * self/environment knowledge.
 *
 * Transient operational inference may be useful, but must stay volatile:
 * high volatility, revalidation-required, shorter dormancy, and no
 * automatic promotion through repetition. Well-grounded self/environment
 * facts ("the kanban board uses Google Tasks as its task authority") are
 * not blocked — they are ordinary user-grounded evidence.
 */

const NOW = 1_800_000_000_000;

function record(overrides: Partial<DurableMemory> = {}): DurableMemory {
  return {
    id: 'memory_pass4',
    kind: 'MICRO_OBSERVATION',
    title: 'Observed detail',
    body: 'A stable fact about the user.',
    createdAt: NOW - 200 * 86_400_000,
    updatedAt: NOW - 200 * 86_400_000,
    observedAt: NOW - 200 * 86_400_000,
    confidence: 0.6,
    importance: 0.35,
    lifecycle: 'active',
    source: { source: 'elara', createdAt: NOW - 200 * 86_400_000 },
    tags: ['organic', 'domain:recurring_context'],
    relatedMemoryIds: [],
    supportingMemoryIds: [],
    conflictingMemoryIds: [],
    supersedes: [],
    supersededBy: [],
    reinforcementCount: 0,
    folderId: null,
    expiresAt: null,
    lastRecalledAt: null,
    recallCount: 0,
    pinned: false,
    autonomyContext: false,
    ...overrides,
  };
}

describe('provenance and volatility normalization', () => {
  it('derives provenance classes from existing canonical authority fields only', () => {
    expect(deriveProvenanceClass(record({ source: { source: 'user', createdAt: 1 }, tags: [] }))).toBe('explicit-user');
    expect(deriveProvenanceClass(record({ source: { source: 'elara', createdAt: 1 }, tags: [] }))).toBe('explicit-user');
    expect(deriveProvenanceClass(record({ source: { source: 'elara', createdAt: 1 }, tags: ['organic'] }))).toBe('user-behavior');
    expect(deriveProvenanceClass(record({ source: { source: 'import', createdAt: 1 }, tags: [] }))).toBe('external-observation');
    expect(deriveProvenanceClass(record({ source: { source: 'migration', createdAt: 1 }, tags: [] }))).toBe('external-observation');
    // An organic tag marks observer-formed user behavior even after archive
    // import re-owns the provenance source.
    expect(deriveProvenanceClass(record({ source: { source: 'import', createdAt: 1 }, tags: ['organic'] }))).toBe('user-behavior');
  });

  it('keeps un-reinforced organic micro-evidence volatile and revalidation-required', () => {
    const profile = deriveMemoryVolatility(record());
    expect(profile).toEqual({ provenanceClass: 'user-behavior', volatility: 'high', requiresRevalidation: true });
  });

  it('softens volatility only through reinforcement, never through repetition of kind', () => {
    const reinforced = deriveMemoryVolatility(record({ reinforcementCount: 1 }));
    expect(reinforced.volatility).toBe('medium');
    expect(reinforced.requiresRevalidation).toBe(false);
    const episodic = deriveMemoryVolatility(record({ kind: 'EPISODIC' }));
    expect(episodic.volatility).toBe('medium');
    const confident = deriveMemoryVolatility(record({ kind: 'CONTEXTUAL', confidence: 0.85 }));
    expect(confident.volatility).toBe('medium');
    const tentative = deriveMemoryVolatility(record({ kind: 'CONTEXTUAL', confidence: 0.75 }));
    expect(tentative.volatility).toBe('high');
  });

  it('treats explicit user direction as stable but operational-state claims as volatile even then', () => {
    const stable = deriveMemoryVolatility(record({ source: { source: 'user', createdAt: 1 }, tags: [] }));
    expect(stable).toEqual({ provenanceClass: 'explicit-user', volatility: 'stable', requiresRevalidation: false });

    const operational = deriveMemoryVolatility(record({
      source: { source: 'user', createdAt: 1 },
      tags: [],
      body: 'CI is currently failing on main.',
    }));
    expect(operational.volatility).toBe('high');
    expect(operational.requiresRevalidation).toBe(true);
  });

  it('detects narrow operational-state hints and not ordinary project facts', () => {
    expect(hasOperationalStateHint('CI is currently failing.')).toBe(true);
    expect(hasOperationalStateHint('PR #79 is still unmerged.')).toBe(true);
    expect(hasOperationalStateHint('The release branch contains the payment feature.')).toBe(true);
    expect(hasOperationalStateHint('The build is red today.')).toBe(true);
    expect(hasOperationalStateHint('this tool is unavailable today')).toBe(true);

    expect(hasOperationalStateHint('The Kanban board uses Google Tasks as the canonical task authority.')).toBe(false);
    expect(hasOperationalStateHint('Memory Bank is the advanced inspection surface.')).toBe(false);
    expect(hasOperationalStateHint('I prefer the compact editor layout.')).toBe(false);
  });
});

describe('self and environment knowledge lifecycle', () => {
  it('recedes unsupported operational micro-evidence after 30 days but ordinary organic evidence after 90', () => {
    const operational = record({
      body: 'CI is currently failing on the main branch.',
      updatedAt: NOW - 31 * 86_400_000,
      createdAt: NOW - 31 * 86_400_000,
      observedAt: NOW - 31 * 86_400_000,
    });
    expect(previewMemoryLifecycleTransition(operational, NOW)).toEqual({ kind: 'MICRO_OBSERVATION', lifecycle: 'dormant', reason: 'stale-organic' });

    const operationalFresh = record({
      body: 'CI is currently failing on the main branch.',
      updatedAt: NOW - 10 * 86_400_000,
      createdAt: NOW - 10 * 86_400_000,
      observedAt: NOW - 10 * 86_400_000,
    });
    expect(previewMemoryLifecycleTransition(operationalFresh, NOW)).toBeNull();

    const ordinary = record({ updatedAt: NOW - 89 * 86_400_000 });
    expect(previewMemoryLifecycleTransition(ordinary, NOW)).toBeNull();
    const ordinaryAged = record({ updatedAt: NOW - 91 * 86_400_000 });
    expect(previewMemoryLifecycleTransition(ordinaryAged, NOW)?.reason).toBe('stale-organic');
  });

  it('never auto-promotes operational organic state, even with repeated reinforcement', () => {
    const operational = record({
      body: 'PR #79 is still unmerged.',
      kind: 'MICRO_OBSERVATION',
      reinforcementCount: 3,
      supportingMemoryIds: ['memory_a', 'memory_b', 'memory_c'],
      confidence: 0.88,
      importance: 0.75,
    });
    expect(previewMemoryLifecycleTransition(operational, NOW)).toBeNull();
  });

  it('still promotes well-grounded, non-operational organic evidence', () => {
    const ordinary = record({
      body: 'The Kanban board uses Google Tasks as the canonical task authority.',
      tags: ['organic', 'domain:project_decision'],
      reinforcementCount: 1,
      supportingMemoryIds: ['memory_a'],
      confidence: 0.68,
    });
    expect(previewMemoryLifecycleTransition(ordinary, NOW)).toEqual({ kind: 'EPISODIC', lifecycle: 'active', reason: 'promote-episodic' });
  });

  it('does not age deliberate non-organic memory, including operational prose', () => {
    const deliberate = record({
      source: { source: 'user', createdAt: 1 },
      tags: [],
      kind: 'CONTEXTUAL',
      body: 'CI is currently failing on main.',
      updatedAt: NOW - 400 * 86_400_000,
    });
    expect(previewMemoryLifecycleTransition(deliberate, NOW)).toBeNull();
  });
});
