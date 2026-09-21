// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { archiveMemory, saveMemory } from './store';
import { writeSemanticFile, listSemanticFiles, type SemanticMemoryFile } from './semantic-file';
import { maintainSemanticFiles, SEMANTIC_MAINTENANCE_DEFAULT_LIMIT } from './semantic-maintenance';

const NAMES = ['Zuhayr', 'Amara', 'Priya', 'Kofi', 'Lena', 'Ravi', 'Tove'];

/**
 * Grounded mock extractor: parses the bounded synthesis input and returns a
 * summary/observation that is verbatim-grounded in the first evidence record,
 * so fail-closed validation accepts it without a model.
 */
function makeExtractor(callLog: string[]) {
  return vi.fn(async (input: string) => {
    callLog.push(input);
    const line = input.split('\n').find((entry) => entry.startsWith('['));
    if (!line) throw new Error('Extractor received no canonical evidence.');
    const match = line.match(/^\[[^\]]*\] \((?:conflicting=(?:yes|no)), volatile=(?:yes|no)\) (.+): (.+)$/);
    if (!match) throw new Error('Unparseable evidence line.');
    const title = match[1];
    const body = match[2];
    return {
      summary: `${title} ${body}`.slice(0, 400),
      recentObservations: [body.slice(0, 200)],
      openConflicts: [],
      aliases: [],
    };
  });
}

async function seedFile(overrides: Partial<SemanticMemoryFile> & Pick<SemanticMemoryFile, 'id' | 'title'>): Promise<void> {
  const file: SemanticMemoryFile = {
    kind: 'person',
    aliases: [],
    summary: 'Grounded summary text.',
    recentObservations: [],
    openConflicts: [],
    sourceMemoryIds: [],
    updatedAt: 1, // predates every source -> stale
    generatedAt: 1,
    version: 1,
    ...overrides,
  };
  await writeSemanticFile(file, 0);
}

/** Seed N distinct concepts, each grounded in one canonical memory. */
async function seedConcepts(count: number, options: { stale?: boolean; aliases?: boolean } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = NAMES[index];
    const source = await saveMemory({ title: `Owner note ${index}`, body: `${name} is the owner of the project.` });
    await seedFile({
      id: `semantic_maint_${String(index).padStart(2, '0')}`,
      title: name,
      aliases: options.aliases && index > 0 ? [String(index)] : [],
      sourceMemoryIds: [source.id],
      updatedAt: options.stale === false ? source.updatedAt : 1,
    });
    ids.push(`semantic_maint_${String(index).padStart(2, '0')}`);
  }
  return ids;
}

describe('semantic cabinet maintenance (Pass 7)', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.memories, db.semanticMemories, async () => {
      await db.memories.clear();
      await db.semanticMemories.clear();
    });
    await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
  });

  it('rebuilds only stale files, one at a time, in deterministic ID order', async () => {
    const staleSource = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await seedFile({ id: 'semantic_maint_b', title: 'Zuhayr', sourceMemoryIds: [staleSource.id] });
    const amaraSource = await saveMemory({ title: 'Design review', body: 'Amara leads the design review.' });
    await seedFile({ id: 'semantic_maint_a', title: 'Amara', aliases: ['A'], sourceMemoryIds: [amaraSource.id], updatedAt: amaraSource.updatedAt });
    const lenaSource = await saveMemory({ title: 'Lena owner', body: 'Lena is the owner of the project.' });
    await seedFile({ id: 'semantic_maint_c', title: 'Lena', sourceMemoryIds: [lenaSource.id], updatedAt: lenaSource.updatedAt });

    const callLog: string[] = [];
    const report = await maintainSemanticFiles(makeExtractor(callLog));

    expect(report.scanned).toBe(3);
    expect(report.stale).toBe(1);
    expect(report.processed).toBe(1);
    expect(report.refreshed).toBe(1);
    expect(report.nextRunHasWork).toBe(false);
    expect(callLog.length).toBe(1);
    expect(callLog[0]).toContain('CONCEPT: kind=person title=Zuhayr');

    // The two fresh files were untouched.
    const after = await listSemanticFiles();
    expect(after.find((file) => file.id === 'semantic_maint_a')?.version).toBe(1);
    expect(after.find((file) => file.id === 'semantic_maint_c')?.version).toBe(1);
    expect(after.find((file) => file.id === 'semantic_maint_b')?.version).toBe(2);
  });

  it('respects the bounded window and converges across successive runs', async () => {
    await seedConcepts(7, { aliases: true });

    const callLog: string[] = [];
    const extractor = makeExtractor(callLog);
    const first = await maintainSemanticFiles(extractor, { limit: 3 });
    expect(first.processed).toBe(3);
    expect(first.deferredFileIds).toEqual(['semantic_maint_03', 'semantic_maint_04', 'semantic_maint_05', 'semantic_maint_06']);
    expect(first.nextRunHasWork).toBe(true);

    const second = await maintainSemanticFiles(extractor, { limit: 3 });
    expect(second.stale).toBe(4);
    expect(second.processed).toBe(3);
    expect(second.nextRunHasWork).toBe(true);

    const third = await maintainSemanticFiles(extractor, { limit: 3 });
    expect(third.processed).toBe(1);
    expect(third.nextRunHasWork).toBe(false);

    const fourth = await maintainSemanticFiles(extractor, { limit: 3 });
    expect(fourth.stale).toBe(0);
    expect(fourth.processed).toBe(0);
    expect(callLog.length).toBe(7);
  });

  it('an aborted signal processes nothing and defers the whole stale set', async () => {
    await seedConcepts(2);

    const callLog: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const report = await maintainSemanticFiles(makeExtractor(callLog), { signal: controller.signal });

    expect(report.stale).toBe(2);
    expect(report.processed).toBe(0);
    expect(callLog.length).toBe(0);
    expect(report.deferredFileIds).toEqual(['semantic_maint_00', 'semantic_maint_01']);
    expect(report.nextRunHasWork).toBe(true);
  });

  it('converges without writes when the stale file has no live evidence left', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await seedFile({ id: 'semantic_maint_00', title: 'Zuhayr', sourceMemoryIds: [source.id] });

    // Archive the only source: the file becomes stale, but the bounded
    // selection is now empty, so the rebuild keeps the last grounded content.
    await archiveMemory(source.id);

    const callLog: string[] = [];
    const report = await maintainSemanticFiles(makeExtractor(callLog));

    expect(report.stale).toBe(1);
    expect(report.processed).toBe(1);
    expect(report.unavailable).toBe(1);
    expect(callLog.length).toBe(0);

    const files = await listSemanticFiles();
    expect(files.find((file) => file.id === 'semantic_maint_00')?.version).toBe(1);
  });

  it('clamps the window to sane bounds', async () => {
    await seedConcepts(6, { aliases: true });

    const callLog: string[] = [];
    const extractor = makeExtractor(callLog);
    const report = await maintainSemanticFiles(extractor, { limit: 0 });
    expect(report.processed).toBe(SEMANTIC_MAINTENANCE_DEFAULT_LIMIT);
    expect(callLog.length).toBe(SEMANTIC_MAINTENANCE_DEFAULT_LIMIT);

    const huge = await maintainSemanticFiles(extractor, { limit: 10_000 });
    expect(huge.processed).toBe(1); // only the one deferred file remains
  });

  it('never mutates canonical memories and never deletes files', async () => {
    await seedConcepts(2);
    const before = JSON.stringify(await db.memories.toArray());
    const filesBefore = await listSemanticFiles();

    const report = await maintainSemanticFiles(makeExtractor([]));

    expect(report.processed).toBe(2);
    expect(JSON.stringify(await db.memories.toArray())).toBe(before);
    expect(await listSemanticFiles()).toHaveLength(filesBefore.length);
  });
});
