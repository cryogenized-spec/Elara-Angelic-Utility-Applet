import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { listMemories } from './store';
import {
  deleteSemanticFile,
  getSemanticFile,
  listSemanticFiles,
  writeSemanticFile,
  SEMANTIC_MAX_FILES,
  type SemanticMemoryFile,
} from './semantic-file';
import { isSemanticFileStale, selectSemanticFileEvidence } from './semantic-evidence';
import { buildSemanticSynthesisInput, validateSemanticSynthesis } from './semantic-synthesis';
import { rebuildSemanticFile } from './semantic-rebuild';
import type { DurableMemory } from './types';

/**
 * Companion continuity Pass 3 — semantic memory files.
 *
 * The cabinet is a strictly derived index: bounded evidence windows, fail
 * closed synthesis validation, provenance back-references, optimistic
 * versioned writes, and zero authority over the canonical memory table.
 */

let sequence = 0;

function evidenceMemory(overrides: Partial<DurableMemory> = {}): DurableMemory {
  sequence += 1;
  const now = 1_700_000_000_000 + sequence * 1000;
  const record = {
    id: `memory_evidence_${sequence}`,
    kind: 'CONTEXTUAL' as const,
    title: `Evidence ${sequence}`,
    body: `Body ${sequence}`,
    createdAt: now,
    updatedAt: now,
    observedAt: now,
    confidence: 0.7,
    importance: 0.5,
    lifecycle: 'active' as const,
    source: { source: 'user' as const, createdAt: now },
    tags: [] as string[],
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
  };
  return { ...record, ...overrides };
}

function fileTemplate(overrides: Partial<SemanticMemoryFile> = {}): SemanticMemoryFile {
  sequence += 1;
  return {
    id: `semantic_file_${sequence}`,
    kind: 'person',
    title: 'Zuhayr',
    aliases: [],
    summary: 'The owner of the project.',
    recentObservations: [],
    openConflicts: [],
    sourceMemoryIds: ['memory_evidence_1'],
    updatedAt: 1_700_000_000_000,
    generatedAt: 1_700_000_000_000,
    version: 1,
    ...overrides,
  };
}

async function resetState(): Promise<void> {
  await db.transaction('rw', db.memories, db.semanticMemories, db.folders, db.folderAssignments, async () => {
    await db.memories.clear();
    await db.semanticMemories.clear();
    await db.folders.clear();
    await db.folderAssignments.clear();
  });
  await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
}

async function putEvidence(record: DurableMemory): Promise<void> {
  await db.memories.put(record);
}

describe('semantic file derived store', () => {
  beforeEach(resetState);

  it('round-trips bounded files and quarantines malformed rows without hiding valid ones', async () => {
    const valid = fileTemplate();
    await writeSemanticFile(valid, 0);
    await db.semanticMemories.put({ id: 'semantic_broken', title: 'nope' } as never);

    const files = await listSemanticFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(valid.id);
    expect(await getSemanticFile(valid.id)).toMatchObject({ kind: 'person', version: 1 });
    await expect(getSemanticFile('semantic_broken')).rejects.toThrow('Invalid semantic memory file');
  });

  it('fails closed when creating over an existing file or at cabinet capacity', async () => {
    const first = fileTemplate({ id: 'semantic_cap_1' });
    await writeSemanticFile(first, 0);
    await expect(writeSemanticFile(fileTemplate({ id: 'semantic_cap_1' }), 0)).rejects.toThrow('already exists');

    const bulk = Array.from({ length: SEMANTIC_MAX_FILES - 1 }, (_, index) => fileTemplate({ id: `semantic_bulk_${index}` }));
    for (const record of bulk) await db.semanticMemories.put(record);
    await expect(writeSemanticFile(fileTemplate({ id: 'semantic_overflow' }), 0)).rejects.toThrow('capacity reached');
  });

  it('advances the version only when content actually changes so rebuilds converge', async () => {
    const base = fileTemplate();
    await writeSemanticFile(base, 0);

    const unchanged = await writeSemanticFile({ ...base, version: 1 }, 1);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.file.version).toBe(1);

    const changed = await writeSemanticFile({ ...base, summary: 'Refreshed summary.', version: 2 }, 1);
    expect(changed.changed).toBe(true);
    expect(changed.file.version).toBe(2);
  });

  it('rejects a stale rebuild so newer content is never clobbered', async () => {
    const base = fileTemplate();
    await writeSemanticFile(base, 0);
    const newer = await writeSemanticFile({ ...base, summary: 'Newer grounded content.', version: 2 }, 1);

    const staleAttempt = fileTemplate({ id: base.id, summary: 'Stale rebuild must not win.', version: 2 });
    await expect(writeSemanticFile(staleAttempt, 1)).rejects.toThrow('Stale semantic memory file update rejected');

    expect(newer.file.version).toBe(2);
    expect((await getSemanticFile(base.id))?.summary).toBe('Newer grounded content.');
  });

  it('clears only the derived view and never the underlying observations', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner.' }));
    const file = fileTemplate({ sourceMemoryIds: ['memory_evidence_1'] });
    await writeSemanticFile(file, 0);

    await deleteSemanticFile(file.id);

    expect(await listSemanticFiles()).toHaveLength(0);
    expect(await listMemories()).toHaveLength(1);
  });
});

describe('deterministic semantic evidence selection', () => {
  beforeEach(resetState);

  it('selects concept evidence by normalized identity keys and never on single-character aliases', () => {
    const zuhayr = evidenceMemory({ body: 'Zuhayr is the owner of the app.' });
    const zohayer = evidenceMemory({ body: 'My cousin Zohayer visits on Sundays.' });
    const unrelated = evidenceMemory({ body: 'Compact layouts feel right to me.' });
    const concept = { kind: 'person' as const, title: 'Zuhayr', aliases: ['Z'] };

    const selection = selectSemanticFileEvidence(concept, [zuhayr, zohayer, unrelated]);
    expect(selection.memories.map((memory) => memory.id)).toEqual([zuhayr.id]);

    const singleChar = selectSemanticFileEvidence({ kind: 'person' as const, title: 'Zed', aliases: ['Z'] }, [evidenceMemory({ body: 'z is a letter' })]);
    expect(singleChar.memories).toHaveLength(0);
  });

  it('selects you-profile and you-preferences evidence from canonical category/domain tags', () => {
    const profile = evidenceMemory({ tags: ['organic', 'domain:persistent_fact', 'category:personal_facts'], body: 'My name is Danielle.' });
    const preference = evidenceMemory({ tags: ['organic', 'domain:preference', 'category:likes_dislikes'], body: 'I prefer compact layouts.' });
    const other = evidenceMemory({ tags: ['organic', 'domain:commitment'], body: 'I will ship the release Friday.' });

    expect(selectSemanticFileEvidence({ kind: 'you-profile' as const, title: 'Profile', aliases: [] }, [profile, preference, other]).memories.map((m) => m.id)).toEqual([profile.id]);
    expect(selectSemanticFileEvidence({ kind: 'you-preferences' as const, title: 'Preferences', aliases: [] }, [profile, preference, other]).memories.map((m) => m.id)).toEqual([preference.id]);
  });

  it('excludes archived, superseded, expired and dormant records from synthesis input', () => {
    const base = { body: 'Zuhayr reviews the design.' };
    const active = evidenceMemory(base);
    const archived = evidenceMemory({ ...base, lifecycle: 'archived' });
    const superseded = evidenceMemory({ ...base, supersededBy: ['memory_replacement'] });
    const expired = evidenceMemory({ ...base, expiresAt: 1 });
    const dormant = evidenceMemory({ ...base, lifecycle: 'dormant' });
    const concept = { kind: 'person' as const, title: 'Zuhayr', aliases: [] };

    expect(selectSemanticFileEvidence(concept, [active, archived, superseded, expired, dormant], Date.now()).memories.map((m) => m.id)).toEqual([active.id]);
  });

  it('is bounded by record count and characters, and deterministic for identical input', () => {
    const many = Array.from({ length: 30 }, (_, index) => evidenceMemory({ body: `Zuhayr detail number ${index}.`, updatedAt: 2_000_000_000_000 - index }));
    const concept = { kind: 'person' as const, title: 'Zuhayr', aliases: [] };
    const now = 3_000_000_000_000;

    const first = selectSemanticFileEvidence(concept, many, now);
    const second = selectSemanticFileEvidence(concept, many, now);
    expect(first.memories).toHaveLength(16);
    expect(first.signatureInput).toBe(second.signatureInput);
    expect(first.memories.map((m) => m.id)).toEqual(second.memories.map((m) => m.id));
    const characters = first.memories.reduce((sum, memory) => sum + memory.title.length + memory.body.length, 0);
    expect(characters).toBeLessThanOrEqual(8_000);
  });

  it('detects staleness when evidence changes, sources vanish, or the window moves', async () => {
    const a = evidenceMemory({ body: 'Zuhayr is the owner.', updatedAt: 1_000_000_000_000 });
    const b = evidenceMemory({ body: 'Zuhayr prefers dark mode.', updatedAt: 1_000_001_000_000 });
    await putEvidence(a);
    await putEvidence(b);
    const concept = { kind: 'person' as const, title: 'Zuhayr', aliases: [] };
    const selection = selectSemanticFileEvidence(concept, [a, b], 2_000_000_000_000);
    const file = fileTemplate({ sourceMemoryIds: selection.memories.map((m) => m.id), updatedAt: selection.maxSourceUpdatedAt });

    expect(isSemanticFileStale(file, [a, b])).toBe(false);

    const changed = { ...b, body: 'Zuhayr switched to light mode.', updatedAt: 1_000_002_000_000 };
    expect(isSemanticFileStale(file, [a, changed])).toBe(true);

    expect(isSemanticFileStale(file, [a])).toBe(true);
    expect(isSemanticFileStale(file, [])).toBe(true);

    const unrelated = evidenceMemory({ body: 'Something else entirely.', updatedAt: 1_500_000_000_000 });
    expect(isSemanticFileStale(file, [a, b, unrelated])).toBe(false);
  });
});

describe('bounded fail-closed synthesis validation', () => {
  beforeEach(resetState);

  const evidence = [
    { id: 'memory_1', title: 'Zuhayr', body: 'Zuhayr is the owner of the project.', conflicting: false, volatile: false },
    { id: 'memory_2', title: 'Layout', body: 'The compact layout was chosen for the kanban.', conflicting: false, volatile: false },
  ];

  it('accepts grounded synthesis with verbatim provenance spans', () => {
    const raw = {
      summary: 'Zuhayr owns the project and chose the compact kanban layout.',
      recentObservations: ['Zuhayr is the owner of the project.'],
      openConflicts: [],
      aliases: ['Z'],
    };
    const validated = validateSemanticSynthesis(raw, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories);
    expect(validated).toMatchObject({ aliases: ['Z'], openConflicts: [] });
    expect(validated?.summary).toBe(raw.summary);
  });

  it('rejects a summary with no meaningful overlap with the evidence', () => {
    const raw = {
      summary: 'The user keeps a pet iguana named Gerald and collects vinyl records.',
      recentObservations: [],
      openConflicts: [],
      aliases: [],
    };
    expect(validateSemanticSynthesis(raw, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
  });

  it('rejects paraphrased recent observations and conflict excerpts that are not verbatim spans', () => {
    const raw = {
      summary: 'Zuhayr owns the project.',
      recentObservations: ['Zuhayr is in charge of the project.'],
      openConflicts: [],
      aliases: [],
    };
    expect(validateSemanticSynthesis(raw, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();

    const conflictingEvidence = [
      { id: 'memory_3', title: 'A', body: 'The deploy window is Tuesday.', conflicting: true, volatile: false },
      { id: 'memory_4', title: 'B', body: 'The deploy window is Friday.', conflicting: true, volatile: false },
    ];
    const missingConflict = {
      summary: 'The deploy window is disputed.',
      recentObservations: ['The deploy window is Tuesday.'],
      openConflicts: [],
      aliases: [],
    };
    expect(validateSemanticSynthesis(missingConflict, conflictingEvidence, 'Deploy', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();

    const withConflict = {
      summary: 'The deploy window is disputed.',
      recentObservations: [],
      openConflicts: ['The deploy window is Tuesday.', 'The deploy window is Friday.'],
      aliases: [],
    };
    expect(validateSemanticSynthesis(withConflict, conflictingEvidence, 'Deploy', DEFAULT_MEMORY_BEHAVIOR.categories)).not.toBeNull();
  });

  it('rejects credential material and policy-disabled sensitive material in any field', () => {
    const credential = {
      summary: 'Zuhayr owns the project.',
      recentObservations: [],
      openConflicts: [],
      aliases: ['api_key is EXAMPLE_NOT_A_REAL_SECRET_12345'],
    };
    expect(validateSemanticSynthesis(credential, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();

    const sensitiveDisabled = {
      summary: 'Zuhayr is the owner; I was diagnosed with diabetes.',
      recentObservations: [],
      openConflicts: [],
      aliases: [],
    };
    expect(validateSemanticSynthesis(sensitiveDisabled, [{ ...evidence[0]!, body: 'Zuhayr is the owner; I was diagnosed with diabetes.' }], 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();

    const sensitiveEnabled = validateSemanticSynthesis(sensitiveDisabled, [{ ...evidence[0]!, body: 'Zuhayr is the owner; I was diagnosed with diabetes.' }], 'Zuhayr', { ...DEFAULT_MEMORY_BEHAVIOR.categories, health_wellbeing: true });
    expect(sensitiveEnabled).not.toBeNull();
  });

  it('rejects malformed or authority-laden synthesis output before any write', () => {
    expect(validateSemanticSynthesis({ summary: '', recentObservations: [], openConflicts: [], aliases: [] }, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
    expect(validateSemanticSynthesis({ summary: 'x'.repeat(401) }, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
    expect(validateSemanticSynthesis({ ...evidence[0], summary: 'nope' }, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
    expect(validateSemanticSynthesis({ summary: 'ok', confidence: 0.99, recentObservations: [], openConflicts: [], aliases: [] }, evidence, 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
    expect(validateSemanticSynthesis({ summary: 'ok', recentObservations: [], openConflicts: [], aliases: [] }, [], 'Zuhayr', DEFAULT_MEMORY_BEHAVIOR.categories)).toBeNull();
  });

  it('builds bounded synthesis input from the evidence window only', () => {
    const input = buildSemanticSynthesisInput(
      { kind: 'person', title: 'Zuhayr', aliases: ['Z'] },
      evidence,
      { summary: 'Old summary.' },
    );
    expect(input).toContain('kind=person');
    expect(input).toContain('Zuhayr is the owner of the project.');
    expect(input).toContain('The compact layout was chosen for the kanban.');
    expect(input).toContain('PREVIOUS SUMMARY');
    expect(input).not.toContain('untrusted assistant');
  });
});

describe('semantic file rebuild', () => {
  beforeEach(resetState);

  const groundedOutput = {
    summary: 'Zuhayr owns the project and prefers the compact kanban layout.',
    recentObservations: ['Zuhayr is the owner of the project.'],
    openConflicts: [],
    aliases: ['Z'],
  };

  it('creates a grounded file for a new concept with application-owned source references', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner of the project.', tags: ['organic', 'domain:persistent_fact', 'category:people_relationships'] }));
    await putEvidence(evidenceMemory({ body: 'Zuhayr prefers the compact layout for the kanban.', tags: ['organic', 'domain:preference', 'category:interests_hobbies_projects'] }));

    const result = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner of the project.' },
      extractor: async () => groundedOutput,
    });

    expect(result.status).toBe('created');
    expect(result.file).toMatchObject({
      kind: 'person',
      title: 'Zuhayr',
      version: 1,
      summary: groundedOutput.summary,
      aliases: ['Z'],
    });
    expect(result.file?.sourceMemoryIds).toHaveLength(2);
    expect(result.file?.sourceMemoryIds.every((id) => id.startsWith('memory_evidence_'))).toBe(true);
    // The canonical table remains untouched by the derived cabinet.
    expect(await listMemories()).toHaveLength(2);
  });

  it('rebuilds only from canonical evidence, never forwarding old summary prose', async () => {
    const source = evidenceMemory({ body: 'Zuhayr is the owner of the project.' });
    await putEvidence(source);
    await writeSemanticFile(fileTemplate({ sourceMemoryIds: [source.id], summary: 'Old private synthesis that must not leave the device.' }), 0);
    let input = '';
    const result = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: source.body },
      extractor: async (value) => { input = value; return groundedOutput; },
    });
    expect(result.status).toBe('refreshed');
    expect(input).toContain(source.body);
    expect(input).not.toContain('Old private synthesis');
    expect(input).not.toContain('PREVIOUS SUMMARY');
  });

  it('does not commit output if the caller aborts during extraction', async () => {
    const source = evidenceMemory({ body: 'Zuhayr is the owner of the project.' });
    await putEvidence(source);
    const controller = new AbortController();
    const result = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: source.body },
      signal: controller.signal,
      extractor: async () => { controller.abort(); return groundedOutput; },
    });
    expect(result.status).toBe('unavailable');
    expect(await listSemanticFiles()).toEqual([]);
  });

  it('converges repeated rebuilds over unchanged evidence and advances the version only on new content', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner of the project.' }));
    const proposal = { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner of the project.' };

    const first = await rebuildSemanticFile({ proposal, extractor: async () => groundedOutput });
    expect(first.status).toBe('created');

    const second = await rebuildSemanticFile({ proposal, extractor: async () => groundedOutput });
    expect(second.status).toBe('unchanged');
    expect(second.file?.version).toBe(1);

    const third = await rebuildSemanticFile({
      proposal,
      extractor: async () => ({ ...groundedOutput, summary: 'Zuhayr owns the project; he prefers dark mode for the kanban.' }),
    });
    expect(third.status).toBe('refreshed');
    expect(third.file?.version).toBe(2);
  });

  it('refuses to invent a file when no canonical evidence grounds the concept', async () => {
    const result = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Nobody', aliases: [], evidenceRef: 'Nobody exists.' },
      extractor: async () => groundedOutput,
    });
    expect(result.status).toBe('unavailable');
    expect(await listSemanticFiles()).toHaveLength(0);
  });

  it('fails safely on ambiguous entity identity without creating or merging', async () => {
    const person = fileTemplate({ id: 'semantic_person_kanban', title: 'Kanban', aliases: [] });
    await writeSemanticFile(person, 0);
    await putEvidence(evidenceMemory({ body: 'Kanban uses Google Tasks as the source of truth for the board.' }));

    const result = await rebuildSemanticFile({
      proposal: { kind: 'project', canonicalLabel: 'Kanban', aliases: [], evidenceRef: 'Kanban uses Google Tasks.' },
      extractor: async () => groundedOutput,
    });

    expect(result.status).toBe('unavailable');
    expect(await listSemanticFiles()).toHaveLength(1);
    expect((await listSemanticFiles())[0]?.id).toBe('semantic_person_kanban');
  });

  it('rejects malformed proposals and hostile or unsupported synthesis before any write', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner of the project.' }));

    expect(await rebuildSemanticFile({
      proposal: { kind: 'organization', canonicalLabel: 'Acme', aliases: [], evidenceRef: 'x' },
      extractor: async () => groundedOutput,
    })).toEqual({ status: 'rejected' });

    expect(await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner.' },
      extractor: async () => ({ summary: 'Completely fabricated content about a penguin colony.' }),
    })).toEqual({ status: 'rejected' });
    expect(await listSemanticFiles()).toHaveLength(0);
  });

  it('treats extractor failure as non-fatal and leaves no partial file behind', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner of the project.' }));

    const result = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner.' },
      extractor: async () => { throw new Error('synthesizer unavailable'); },
    });

    expect(result.status).toBe('unavailable');
    expect(await listSemanticFiles()).toHaveLength(0);
  });

  it('converges concurrent rebuilds of the same concept onto one file without duplication', async () => {
    await putEvidence(evidenceMemory({ body: 'Zuhayr is the owner of the project.' }));
    const proposal = { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner.' };

    const [first, second] = await Promise.all([
      rebuildSemanticFile({ proposal, extractor: async () => groundedOutput }),
      rebuildSemanticFile({ proposal, extractor: async () => groundedOutput }),
    ]);

    // One create wins; the other observes the existing file and fails closed
    // instead of duplicating or clobbering. A caller may simply retry.
    expect([first.status, second.status].sort()).toEqual(['created', 'unavailable']);
    const files = await listSemanticFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.version).toBe(1);
    expect(files[0]?.summary).toBe(groundedOutput.summary);
  });

  it('applies a name correction as a rename preserving the historical alias', async () => {
    await putEvidence(evidenceMemory({ body: 'Dovy works on the mobile app.' }));
    const first = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Dovy', aliases: [], evidenceRef: 'Dovy works on the mobile app.' },
      extractor: async () => ({ summary: 'Dovy works on the mobile app.', recentObservations: ['Dovy works on the mobile app.'], openConflicts: [], aliases: [] }),
    });
    expect(first.status).toBe('created');

    await putEvidence(evidenceMemory({ body: 'Dovy is actually Dawie.' }));
    const corrected = await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Dawie', aliases: ['Dovy'], evidenceRef: 'Dovy is actually Dawie.' },
      extractor: async () => ({ summary: 'Dawie (formerly Dovy) works on the mobile app.', recentObservations: ['Dovy is actually Dawie.'], openConflicts: [], aliases: ['Dovy'] }),
    });

    expect(corrected.status).toBe('refreshed');
    expect(corrected.file?.title).toBe('Dawie');
    expect(corrected.file?.aliases).toContain('Dovy');
    expect(corrected.file?.id).toBe(first.file?.id);
  });
});

describe('semantic cabinet isolation from canonical memory', () => {
  beforeEach(resetState);

  it('never surfaces semantic files through canonical recall reads, and semantic writes never mutate canonical rows', async () => {
    const record = evidenceMemory({ body: 'Zuhayr is the owner of the project.' });
    await putEvidence(record);
    const before = (await listMemories())[0]!;

    await rebuildSemanticFile({
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: 'Zuhayr is the owner.' },
      extractor: async () => groundedOutputFor(record),
    });

    const after = (await listMemories())[0]!;
    expect(after).toEqual(before);
    expect(await listMemories()).toHaveLength(1);
    expect(await db.semanticMemories.count()).toBe(1);
  });
});

function groundedOutputFor(record: DurableMemory) {
  return {
    summary: `${record.title} is grounded in ${record.body}`,
    recentObservations: [record.body],
    openConflicts: [],
    aliases: [],
  };
}

describe('review regressions: evidence boundaries and identity updates', () => {
  beforeEach(resetState);

  it('matches whole Unicode identity spans, not names embedded in unrelated words', () => {
    const records = [
      evidenceMemory({ title: 'Notes', body: 'Call the small mobile team.' }),
      evidenceMemory({ title: 'Notes', body: 'Al owns this project.' }),
      evidenceMemory({ title: 'Notes', body: 'Élodie leads the team.' }),
    ];
    expect(selectSemanticFileEvidence({ kind: 'person', title: 'Al', aliases: ['Mo'] }, records).memories.map((m) => m.body)).toEqual(['Al owns this project.']);
    expect(selectSemanticFileEvidence({ kind: 'person', title: 'Élodie', aliases: [] }, records).memories).toHaveLength(1);
    expect(selectSemanticFileEvidence({ kind: 'topic', title: 'C++', aliases: [] }, [evidenceMemory({ body: 'I use C++ daily.' })]).memories).toHaveLength(1);
  });

  it('rejects title and alias collisions on update without changing either file', async () => {
    const first = fileTemplate({ id: 'semantic_first', title: 'Al', aliases: [] });
    const second = fileTemplate({ id: 'semantic_second', title: 'Jo', aliases: ['Joseph'] });
    await writeSemanticFile(first, 0);
    await writeSemanticFile(second, 0);
    for (const patch of [{ title: 'Ｊｏ' }, { aliases: ['Joseph'] }]) {
      await expect(writeSemanticFile({ ...first, ...patch, version: 2 }, 1)).rejects.toThrow('overlapping identity');
    }
    expect(await getSemanticFile(first.id)).toEqual(first);
    expect(await getSemanticFile(second.id)).toEqual(second);
  });
});


describe('review regression: creation policy boundary', () => {
  beforeEach(resetState);
  it('does not call the model for disabled memory or blocked source text', async () => {
    const source = evidenceMemory({ body: 'Zuhayr was diagnosed with diabetes.' });
    await putEvidence(source);
    let calls = 0;
    const request = {
      proposal: { kind: 'person', canonicalLabel: 'Zuhayr', aliases: [], evidenceRef: source.body },
      extractor: async () => { calls += 1; return {}; },
    };
    expect((await rebuildSemanticFile(request)).status).toBe('unavailable');
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });
    expect((await rebuildSemanticFile(request)).status).toBe('unavailable');
    expect(calls).toBe(0);
    expect(await listSemanticFiles()).toEqual([]);
    expect(await listMemories()).toEqual([source]);
  });
});
