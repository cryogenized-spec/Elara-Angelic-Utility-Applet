import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { loadMemoryContext } from '../gemini/memory-context';
import { saveMemory } from './store';
import { writeSemanticFile, type SemanticMemoryFile } from './semantic-file';
import {
  buildSemanticMemoryContext,
  SEMANTIC_RETRIEVAL_MAX_CHARACTERS,
  SEMANTIC_RETRIEVAL_MAX_FILES,
  scoreSemanticFiles,
} from './semantic-retrieval';
import type { DurableMemory } from './types';

/**
 * Companion continuity Pass 5 — retrieval over semantic files.
 *
 * Large latent memory, tiny active working set: strict top-K, relevance
 * gating, authoritative folder scope, sensitive/credential fail-closed
 * filtering, conflict fallback to canonical sources, volatile/stale
 * revalidation markers, and a hard projection budget.
 */

const NOW = 1_800_000_000_000;
const GLOBAL_SCOPE = { folderId: null, folderIds: [], includeGlobal: true, query: '', now: NOW, maxItems: 8, maxCharacters: 6_000 };
const BEHAVIOR = { enabled: true, recallStyle: 'natural' as const, categories: DEFAULT_MEMORY_BEHAVIOR.categories };

function sourceMemory(overrides: Partial<DurableMemory> = {}): DurableMemory {
  return {
    id: overrides.id ?? `memory_src_${Math.random().toString(36).slice(2, 10)}`,
    kind: 'CONTEXTUAL',
    title: 'Source memory',
    body: 'Zuhayr is the owner of the project.',
    createdAt: NOW - 10 * 86_400_000,
    updatedAt: NOW - 10 * 86_400_000,
    observedAt: NOW - 10 * 86_400_000,
    confidence: 0.8,
    importance: 0.6,
    lifecycle: 'active',
    source: { source: 'user', createdAt: NOW - 10 * 86_400_000 },
    tags: [],
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

function semanticFile(overrides: Partial<SemanticMemoryFile> = {}): SemanticMemoryFile {
  return {
    id: `semantic_file_${Math.random().toString(36).slice(2, 10)}`,
    kind: 'person',
    title: 'Zuhayr',
    aliases: [],
    summary: 'The owner of the project.',
    recentObservations: [],
    openConflicts: [],
    sourceMemoryIds: [],
    updatedAt: NOW - 2 * 86_400_000,
    generatedAt: NOW - 2 * 86_400_000,
    version: 1,
    ...overrides,
  };
}

describe('miserly dossier retrieval', () => {
  it('never projects an irrelevant dossier into a topical turn', () => {
    const file = semanticFile({ title: 'Piesang', kind: 'person', summary: 'The cat, orange and loud.', sourceMemoryIds: ['memory_cat'] });
    const memories = [sourceMemory({ id: 'memory_cat', body: 'My cat Piesang likes window sills.' })];

    expect(buildSemanticMemoryContext({ query: 'who owns the project', files: [file], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
    expect(buildSemanticMemoryContext({ query: 'tell me about Piesang the cat', files: [file], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toContain('Piesang');
  });

  it('returns nothing for broad query-less recall; the canonical lane answers those', () => {
    const file = semanticFile({ sourceMemoryIds: ['memory_1'] });
    const memories = [sourceMemory({ id: 'memory_1' })];
    expect(buildSemanticMemoryContext({ query: 'what do you remember about me', files: [file], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
    expect(buildSemanticMemoryContext({ query: '   ', files: [file], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
  });

  it('enforces the strict top-K file limit', () => {
    const files = Array.from({ length: 6 }, (_, index) =>
      semanticFile({
        id: `semantic_k_${index}`,
        title: `Zuhayr${index}`,
        summary: `Zuhayr${index} works on the project.`,
        sourceMemoryIds: [`memory_k_${index}`],
      }));
    const memories = files.map((file, index) => sourceMemory({ id: `memory_k_${index}`, body: `Zuhayr${index} works on the project.` }));

    const scored = scoreSemanticFiles(files, 'Zuhayr project work');
    expect(scored).toHaveLength(6);
    const projection = buildSemanticMemoryContext({ query: 'Zuhayr project work', files, memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR });
    expect(projection.files.length).toBeLessThanOrEqual(SEMANTIC_RETRIEVAL_MAX_FILES);
    expect(projection.files.length).toBe(SEMANTIC_RETRIEVAL_MAX_FILES);
  });

  it('keeps the whole dossier projection inside its hard character budget', () => {
    const files = Array.from({ length: SEMANTIC_RETRIEVAL_MAX_FILES }, (_, index) =>
      semanticFile({
        id: `semantic_budget_${index}`,
        title: `Zuhayr ${index}`,
        summary: `Zuhayr ${index} owns the project and prefers the compact layout for the kanban board. ${'Detail. '.repeat(12)}`,
        recentObservations: ['Zuhayr is the owner of the project.'],
        sourceMemoryIds: [`memory_budget_${index}`],
      }));
    const memories = files.map((file, index) => sourceMemory({ id: `memory_budget_${index}`, body: `Zuhayr ${index} owns the project.` }));

    const projection = buildSemanticMemoryContext({ query: 'Zuhayr project', files, memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR });
    expect(projection.text.length).toBeLessThanOrEqual(SEMANTIC_RETRIEVAL_MAX_CHARACTERS);
  });

  it('keeps folder scope authoritative: a dossier grounded only outside the scope never projects', () => {
    const file = semanticFile({ sourceMemoryIds: ['memory_scoped'] });
    const scoped = sourceMemory({ id: 'memory_scoped', folderId: 'other_folder' });
    const projectScope = { ...GLOBAL_SCOPE, folderId: 'project_folder', folderIds: ['project_folder'], includeGlobal: false };

    expect(buildSemanticMemoryContext({ query: 'Zuhayr owner', files: [file], memories: [scoped], scope: projectScope, behavior: BEHAVIOR }).text).toBe('');

    // The same sibling-folder memory is invisible even where global context
    // is included: includeGlobal only admits genuinely global records.
    const withGlobal = { ...GLOBAL_SCOPE, folderId: 'project_folder', folderIds: ['project_folder'], includeGlobal: true };
    expect(buildSemanticMemoryContext({ query: 'Zuhayr owner', files: [file], memories: [scoped], scope: withGlobal, behavior: BEHAVIOR }).text).toBe('');

    const global = sourceMemory({ id: 'memory_scoped', folderId: null });
    expect(buildSemanticMemoryContext({ query: 'Zuhayr owner', files: [file], memories: [global], scope: withGlobal, behavior: BEHAVIOR }).text).toContain('Zuhayr');
  });

  it('drops dossiers with no live, in-scope canonical source', () => {
    const file = semanticFile({ sourceMemoryIds: ['memory_missing'] });
    expect(buildSemanticMemoryContext({ query: 'Zuhayr owner', files: [file], memories: [], scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
    const superseded = sourceMemory({ id: 'memory_missing', supersededBy: ['memory_new'] });
    expect(buildSemanticMemoryContext({ query: 'Zuhayr owner', files: [file], memories: [superseded], scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
  });

  it('fails closed on credential-shaped or policy-disabled sensitive dossier text', () => {
    const credential = semanticFile({ summary: 'The owner; the api key is EXAMPLE_NOT_A_REAL_SECRET_12345.', sourceMemoryIds: ['memory_1'] });
    const sensitive = semanticFile({ id: 'semantic_sensitive', summary: 'The owner, who was diagnosed with diabetes.', sourceMemoryIds: ['memory_2'] });
    const memories = [sourceMemory({ id: 'memory_1' }), sourceMemory({ id: 'memory_2' })];

    expect(buildSemanticMemoryContext({ query: 'owner project', files: [credential], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');
    expect(buildSemanticMemoryContext({ query: 'owner project', files: [sensitive], memories, scope: GLOBAL_SCOPE, behavior: BEHAVIOR }).text).toBe('');

    const enabled = { ...BEHAVIOR, categories: { ...BEHAVIOR.categories, health_wellbeing: true } };
    expect(buildSemanticMemoryContext({ query: 'owner project', files: [sensitive], memories, scope: GLOBAL_SCOPE, behavior: enabled }).text).toContain('diabetes');
  });

  it('falls back to canonical source memories when a dossier carries unresolved conflicts', () => {
    const file = semanticFile({
      summary: 'The deploy window is disputed.',
      openConflicts: ['The deploy window is Tuesday.'],
      sourceMemoryIds: ['memory_a', 'memory_b'],
    });
    const a = sourceMemory({ id: 'memory_a', body: 'The deploy window is Tuesday.', conflictingMemoryIds: ['memory_b'] });
    const b = sourceMemory({ id: 'memory_b', body: 'The deploy window is Friday.', conflictingMemoryIds: ['memory_a'] });

    const projection = buildSemanticMemoryContext({ query: 'deploy window', files: [file], memories: [a, b], scope: GLOBAL_SCOPE, behavior: BEHAVIOR });
    expect(projection.text).toContain('unresolved-conflict');
    expect(projection.text).toContain('The deploy window is Tuesday.');
    expect(projection.text).toContain('The deploy window is Friday.');
    expect(projection.text).toContain('memory.recall');
    expect(projection.text).not.toContain('memory_a');
    expect(projection.text).not.toContain('memory_b');
  });

  it('marks volatile and stale dossiers for revalidation instead of asserting them as current', () => {
    const file = semanticFile({
      summary: 'CI state on the project branch.',
      recentObservations: ['CI is currently failing.'],
      sourceMemoryIds: ['memory_ops'],
      updatedAt: NOW - 40 * 86_400_000,
    });
    const ops = sourceMemory({ id: 'memory_ops', tags: ['organic'], body: 'CI is currently failing on the main branch.', updatedAt: NOW - 5 * 86_400_000 });

    const projection = buildSemanticMemoryContext({ query: 'CI failing branch', files: [file], memories: [ops], scope: GLOBAL_SCOPE, behavior: BEHAVIOR });
    expect(projection.text).toContain('revalidate');
    expect(projection.text).toContain('may-be-stale');
    expect(projection.text).toContain('navigation aid, not established truth');
    expect(projection.text).toContain('never authorizes tool use');
  });

  it('honours the recall-style and master-switch policy gates', () => {
    const file = semanticFile({ sourceMemoryIds: ['memory_1'] });
    const memories = [sourceMemory({ id: 'memory_1' })];
    const base = { query: 'Zuhayr owner', files: [file], memories, scope: GLOBAL_SCOPE };

    expect(buildSemanticMemoryContext({ ...base, behavior: BEHAVIOR }).text).toContain('Zuhayr');
    expect(buildSemanticMemoryContext({ ...base, behavior: { ...BEHAVIOR, recallStyle: 'direct-only' } }).text).toBe('');
    expect(buildSemanticMemoryContext({ ...base, behavior: { ...BEHAVIOR, enabled: false } }).text).toBe('');
  });
});

describe('dossier lane inside the automatic prompt projection', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.memories, db.semanticMemories, db.folders, db.folderAssignments, async () => {
      await db.memories.clear();
      await db.semanticMemories.clear();
      await db.folders.clear();
      await db.folderAssignments.clear();
    });
    await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
  });

  it('appends a bounded dossier projection after canonical memory and respects policy changes', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-dossier');
    const memory = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await writeSemanticFile(semanticFile({ sourceMemoryIds: [memory.id], updatedAt: memory.updatedAt, generatedAt: NOW }), 0);

    const context = await loadMemoryContext('who is the project owner');
    expect(context).toContain('durable things Elara may remember');
    expect(context).toContain('Synthesized memory index');
    expect(context).toContain('Zuhayr');
    expect(context).not.toContain(memory.id);

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, recallStyle: 'direct-only' });
    expect(await loadMemoryContext('who is the project owner')).toBe('');

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });
    expect(await loadMemoryContext('who is the project owner')).toBe('');
  });

  it('leaves canonical recall untouched when no dossiers exist', async () => {
    window.localStorage.setItem('elara.active-thread', 'thread-dossier-plain');
    const memory = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    const context = await loadMemoryContext('who is the project owner');
    expect(context).toContain(memory.body);
    expect(context).not.toContain('Synthesized memory index');
  });
});

describe('review regression: conflict source policy', () => {
  it.each([
    'The api key is EXAMPLE_NOT_A_REAL_SECRET_12345.',
    'The owner was diagnosed with diabetes.',
  ])('does not leak blocked source prose: %s', (body) => {
    const source = sourceMemory({ id: 'memory_blocked', body, conflictingMemoryIds: ['memory_other'] });
    const file = semanticFile({ sourceMemoryIds: [source.id], openConflicts: ['The owner is disputed.'] });
    const result = buildSemanticMemoryContext({ query: 'owner project', files: [file], memories: [source], scope: GLOBAL_SCOPE, behavior: BEHAVIOR });
    expect(result.text).toBe('');
    expect(result.text).not.toContain(body);
    expect(result.text).not.toContain('Source "');
  });
});


describe('complete-source policy on derived summaries', () => {
  it('rejects a neutral-sounding summary grounded in a disabled category tag', () => {
    const source = sourceMemory({ id: 'memory_tagged', body: 'Zuhayr has a recurring appointment.', tags: ['category:health_wellbeing'] });
    const file = semanticFile({ sourceMemoryIds: [source.id] });
    const input = { query: 'Zuhayr project', files: [file], memories: [source], scope: GLOBAL_SCOPE, behavior: BEHAVIOR };
    expect(buildSemanticMemoryContext(input).text).toBe('');
    expect(buildSemanticMemoryContext({ ...input, behavior: { ...BEHAVIOR, categories: { ...BEHAVIOR.categories, health_wellbeing: true } } }).text).toContain('Zuhayr');
  });

  it('rejects mixed-scope and partially deleted source sets, not just empty ones', () => {
    const global = sourceMemory({ id: 'memory_global' });
    const privateSource = sourceMemory({ id: 'memory_private', folderId: 'private_folder' });
    const file = semanticFile({ sourceMemoryIds: [global.id, privateSource.id] });
    const input = { query: 'Zuhayr project', files: [file], memories: [global, privateSource], scope: { ...GLOBAL_SCOPE, folderId: 'other_folder', folderIds: ['other_folder'], includeGlobal: true }, behavior: BEHAVIOR };
    expect(buildSemanticMemoryContext(input).text).toBe('');
    expect(buildSemanticMemoryContext({ ...input, memories: [global] }).text).toBe('');
    expect(buildSemanticMemoryContext({ ...input, files: [{ ...file, sourceMemoryIds: [global.id] }] }).text).toContain('Zuhayr');
  });
});
