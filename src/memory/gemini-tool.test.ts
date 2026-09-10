import { describe, expect, it } from 'vitest';
import {
  isMemoryToolName,
  memoryGeminiFunctionDeclarations,
  memoryGeminiFunctionNames,
  memorySaveToolArgsSchema,
  memoryToolNameSchema,
  memoryToolRegistry,
} from './gemini-tool';
import { MEMORY_BODY_MAX_LENGTH, MEMORY_TITLE_MAX_LENGTH } from './normalize';

describe('memory Gemini tool contract', () => {
  it('exposes exactly memory.save to Gemini', () => {
    expect(memoryGeminiFunctionNames()).toEqual(['memory.save']);
    expect(memoryGeminiFunctionDeclarations).toHaveLength(1);
    const [declaration] = memoryGeminiFunctionDeclarations;
    expect(declaration.type).toBe('function');
    expect(declaration.name).toBe('memory.save');
    expect(declaration.description).toMatch(/deliberately/);
    expect(declaration.parameters.type).toBe('object');
    expect(declaration.parameters.additionalProperties).toBe(false);
    expect(declaration.parameters.required).toEqual(['title', 'body']);
    expect(Object.keys(declaration.parameters.properties).sort()).toEqual(['body', 'kind', 'tags', 'title']);
  });

  it('maps every present and future memory tool to exactly one permission with one exposure', () => {
    expect(memoryToolRegistry.map((descriptor) => [descriptor.name, descriptor.permission, descriptor.exposure])).toEqual([
      ['memory.save', 'save', 'gemini'],
      ['memory.observe', 'observe', 'internal'],
      ['memory.consolidate', 'consolidate', 'internal'],
      ['memory.forget', 'forget', 'internal'],
      ['memory.delete', 'delete', 'internal'],
    ]);
    expect(memoryToolNameSchema.options).toEqual(['memory.save', 'memory.observe', 'memory.consolidate', 'memory.forget', 'memory.delete']);
    expect(isMemoryToolName('memory.save')).toBe(true);
    expect(isMemoryToolName('memory.delete')).toBe(true);
    expect(isMemoryToolName('calendar.listEvents')).toBe(false);
    expect(isMemoryToolName('memory.invented')).toBe(false);
  });

  it('accepts minimal and fully-specified save requests', () => {
    expect(memorySaveToolArgsSchema.safeParse({ title: 'Cat food', body: 'Buys cat food weekly.' }).success).toBe(true);
    const full = memorySaveToolArgsSchema.safeParse({
      title: 'Cat food',
      body: 'Buys cat food roughly once a week.',
      kind: 'CONTEXTUAL',
      tags: ['pets', 'shopping'],
    });
    expect(full.success).toBe(true);
    if (full.success) {
      expect(full.data).toEqual({ title: 'Cat food', body: 'Buys cat food roughly once a week.', kind: 'CONTEXTUAL', tags: ['pets', 'shopping'] });
    }
  });

  it.each([
    ['missing title', { body: 'Some body.' }],
    ['missing body', { title: 'Some title' }],
    ['empty title', { title: '', body: 'Some body.' }],
    ['whitespace-only title', { title: '   ', body: 'Some body.' }],
    ['empty body', { title: 'Some title', body: '' }],
    ['whitespace-only body', { title: 'Some title', body: '  \n ' }],
    ['invalid kind', { title: 'T', body: 'B', kind: 'IMPORTANT' }],
    ['observation kind through save', { title: 'T', body: 'B', kind: 'MICRO_OBSERVATION' }],
    ['non-string title', { title: 42, body: 'B' }],
    ['non-object tags', { title: 'T', body: 'B', tags: 'pets' }],
  ])('rejects %s', (_label, args) => {
    expect(memorySaveToolArgsSchema.safeParse(args).success).toBe(false);
  });

  it('rejects oversized data', () => {
    expect(memorySaveToolArgsSchema.safeParse({ title: 'x'.repeat(MEMORY_TITLE_MAX_LENGTH + 1), body: 'B' }).success).toBe(false);
    expect(memorySaveToolArgsSchema.safeParse({ title: 'T', body: 'x'.repeat(MEMORY_BODY_MAX_LENGTH + 1) }).success).toBe(false);
    expect(memorySaveToolArgsSchema.safeParse({ title: 'T', body: 'B', tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`) }).success).toBe(false);
    expect(memorySaveToolArgsSchema.safeParse({ title: 'T', body: 'B', tags: ['x'.repeat(65)] }).success).toBe(false);
  });

  it.each([
    'id',
    'createdAt',
    'updatedAt',
    'observedAt',
    'source',
    'folderId',
    'lifecycle',
    'expiresAt',
    'autonomyContext',
    'reinforcementCount',
    'confidence',
    'importance',
    'relatedMemoryIds',
    'supportingMemoryIds',
    'conflictingMemoryIds',
    'supersedes',
    'supersededBy',
    'lastRecalledAt',
    'recallCount',
  ])('rejects the application-owned field %s', (field) => {
    expect(memorySaveToolArgsSchema.safeParse({ title: 'T', body: 'B', [field]: 'intrusion' }).success).toBe(false);
  });
});
