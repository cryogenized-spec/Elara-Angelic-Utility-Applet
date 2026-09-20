import { describe, expect, it } from 'vitest';
import type { FolderState } from '../persistence/folders';
import { formatMemoryContext, isContinuityAnchor, isMemoryRetrievable, lexicalMemoryRelevance, memoryScopeForConversation, rankAndBudgetMemories } from './retrieval';
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

  it('excludes zero-overlap memories from query-bearing retrieval regardless of generic salience', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'relevant', title: 'Mother visit', body: 'The user plans to visit their mother this weekend.', importance: 0.4, confidence: 0.6 }),
      makeMemory({ id: 'unrelated-core', kind: 'CORE', title: 'Favorite game', body: 'The user loves old role-playing games.', importance: 1, confidence: 1, pinned: true }),
    ], { query: 'mother weekend', includeGlobal: true });

    expect(result.map((memory) => memory.id)).toEqual(['relevant']);
  });

  it('ignores conversational stopwords when deciding whether memory is relevant', () => {
    const mother = makeMemory({ id: 'mother', title: 'Mother', body: 'The user mentioned their mother.' });
    const cat = makeMemory({ id: 'cat', title: 'Cat', body: 'The user said my cat likes tuna.' });

    expect(lexicalMemoryRelevance(mother, 'what do you remember about my mother')).toBeGreaterThan(0);
    expect(lexicalMemoryRelevance(cat, 'what do you remember about my mother')).toBe(0);
    expect(rankAndBudgetMemories([mother, cat], { query: 'what do you remember about my mother' }).map((memory) => memory.id))
      .toEqual(['mother']);
  });

  it('keeps a broad deliberate memory query available when it contains no substantive search terms', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'a', title: 'Pet', body: 'The user has a cat named Piesang.' }),
      makeMemory({ id: 'b', title: 'Routine', body: 'The user likes quiet mornings.' }),
    ], { query: 'what do you remember about me', includeGlobal: true });

    expect(result.map((memory) => memory.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps query-less ranking unfiltered for explicit non-conversational ranking authorities', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'important', importance: 1, confidence: 1 }),
      makeMemory({ id: 'ordinary', importance: 0.1, confidence: 0.1 }),
    ], { includeGlobal: true, query: '' });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('important');
  });

  it('adds at most one established unrelated continuity anchor in proactive mode after relevant memories', () => {
    const result = rankAndBudgetMemories([
      makeMemory({ id: 'relevant', title: 'Garden plan', body: 'The user is planting basil in the garden.' }),
      makeMemory({ id: 'anchor', kind: 'CORE', title: 'Long-term identity', body: 'The user values gentle daily reflection.', importance: 1, confidence: 1 }),
      makeMemory({ id: 'second-anchor', kind: 'CORE', title: 'Another landmark', body: 'The user loves elaborate fantasy worlds.', importance: 0.8, confidence: 0.9 }),
      makeMemory({ id: 'micro', kind: 'MICRO_OBSERVATION', title: 'Tentative note', body: 'Possibly likes red mugs.', pinned: true }),
      makeMemory({ id: 'conflicted', kind: 'CORE', title: 'Conflicted landmark', body: 'Old uncertain identity note.', conflictingMemoryIds: ['conflict'] }),
    ], { query: 'garden basil', includeGlobal: true, mode: 'proactive' });

    expect(result[0]?.id).toBe('relevant');
    expect(result).toHaveLength(2);
    expect(result.map((memory) => memory.id)).toContain('anchor');
    expect(result.map((memory) => memory.id)).not.toContain('second-anchor');
    expect(result.map((memory) => memory.id)).not.toContain('micro');
    expect(result.map((memory) => memory.id)).not.toContain('conflicted');
  });

  it('never lets a proactive anchor displace relevant memories from a full item budget', () => {
    const relevant = Array.from({ length: 2 }, (_, index) => makeMemory({
      id: `relevant-${index}`,
      title: `Garden ${index}`,
      body: 'Garden basil plan.',
    }));
    const anchor = makeMemory({ id: 'anchor', kind: 'CORE', title: 'Identity', body: 'Unrelated enduring context.', importance: 1, confidence: 1 });

    const result = rankAndBudgetMemories([...relevant, anchor], {
      query: 'garden basil',
      mode: 'proactive',
      maxItems: 2,
    });

    expect(result.map((memory) => memory.id).sort()).toEqual(['relevant-0', 'relevant-1']);
  });

  it('defines continuity anchors conservatively', () => {
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE' }))).toBe(true);
    expect(isContinuityAnchor(makeMemory({ kind: 'CONTEXTUAL', importance: 0.9, confidence: 0.9 }))).toBe(true);
    expect(isContinuityAnchor(makeMemory({ kind: 'EPISODIC', pinned: true }))).toBe(true);
    expect(isContinuityAnchor(makeMemory({ kind: 'MICRO_OBSERVATION', pinned: true }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', lifecycle: 'dormant' }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', conflictingMemoryIds: ['x'] }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', tags: ['category:health_wellbeing'] }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', tags: ['category:money_finances'], pinned: true }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', title: 'Health note', body: 'I was diagnosed with diabetes.' }))).toBe(false);
    expect(isContinuityAnchor(makeMemory({ kind: 'CORE', title: 'Account note', body: 'Bank account number: 1234567890' }))).toBe(false);
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
    expect(context).toContain('Use a memory naturally only when it materially helps');
    expect(context).toContain('use memory.recall rather than pretending to remember');
    expect(context).toContain('Prefer what the user says now');
    expect(context).not.toContain('secret-internal-id');
  });

  it('labels micro-observations as tentative context', () => {
    const memory = {
      ...makeMemory({ id: 'tentative', kind: 'MICRO_OBSERVATION', body: 'The user may prefer tea.' }),
      score: 1,
    };
    expect(formatMemoryContext([memory])).toContain('[MICRO_OBSERVATION; tentative]');
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