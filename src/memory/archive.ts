import { z } from 'zod';
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_MAX_RELATIONSHIPS,
  MEMORY_MAX_TAGS,
  MEMORY_TAG_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
} from './normalize';
import { runMemoryMutationTransaction, saveMemory, updateMemory } from './store';
import { MEMORY_KINDS, MEMORY_LIFECYCLES, MEMORY_SOURCES, type DurableMemory, type MemoryKind } from './types';

export const MEMORY_ARCHIVE_FORMAT = 'elara-memory-bank' as const;
export const MEMORY_ARCHIVE_VERSION = 1 as const;
export const MEMORY_ARCHIVE_MAX_RECORDS = 5_000;
export const MEMORY_ARCHIVE_MAX_BYTES = 5_000_000;

const archiveRelationshipSchema = z.array(z.string().min(1).max(64)).max(MEMORY_MAX_RELATIONSHIPS);

/**
 * Portable archive records deliberately omit canonical durable IDs, folder
 * authority, conversation/message lineage, recall telemetry and autonomy
 * consent. `archiveId` exists only to reconnect relationships inside this file.
 */
export const memoryArchiveRecordSchema = z.object({
  archiveId: z.string().min(1).max(64),
  kind: z.enum(MEMORY_KINDS),
  title: z.string().min(1).max(MEMORY_TITLE_MAX_LENGTH),
  body: z.string().min(1).max(MEMORY_BODY_MAX_LENGTH),
  observedAt: z.number().finite(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  lifecycle: z.enum(MEMORY_LIFECYCLES),
  originSource: z.enum(MEMORY_SOURCES),
  tags: z.array(z.string().min(1).max(MEMORY_TAG_MAX_LENGTH)).max(MEMORY_MAX_TAGS),
  related: archiveRelationshipSchema,
  supporting: archiveRelationshipSchema,
  conflicting: archiveRelationshipSchema,
  supersedes: archiveRelationshipSchema,
  supersededBy: archiveRelationshipSchema,
  expiresAt: z.number().finite().nullable(),
  pinned: z.boolean().default(false),
}).strict();

export const memoryArchiveSchema = z.object({
  format: z.literal(MEMORY_ARCHIVE_FORMAT),
  version: z.literal(MEMORY_ARCHIVE_VERSION),
  exportedAt: z.number().finite(),
  memories: z.array(memoryArchiveRecordSchema).max(MEMORY_ARCHIVE_MAX_RECORDS),
}).strict().superRefine((archive, context) => {
  const ids = new Set<string>();
  for (let index = 0; index < archive.memories.length; index += 1) {
    const memory = archive.memories[index]!;
    if (ids.has(memory.archiveId)) {
      context.addIssue({ code: 'custom', path: ['memories', index, 'archiveId'], message: 'Archive memory identifiers must be unique.' });
    }
    ids.add(memory.archiveId);
  }

  const relationshipFields = ['related', 'supporting', 'conflicting', 'supersedes', 'supersededBy'] as const;
  for (let index = 0; index < archive.memories.length; index += 1) {
    const memory = archive.memories[index]!;
    for (const field of relationshipFields) {
      const seen = new Set<string>();
      for (let relationIndex = 0; relationIndex < memory[field].length; relationIndex += 1) {
        const target = memory[field][relationIndex]!;
        if (target === memory.archiveId) {
          context.addIssue({ code: 'custom', path: ['memories', index, field, relationIndex], message: 'Archive relationships cannot point to the same record.' });
        } else if (!ids.has(target)) {
          context.addIssue({ code: 'custom', path: ['memories', index, field, relationIndex], message: 'Archive relationship target is missing.' });
        }
        if (seen.has(target)) {
          context.addIssue({ code: 'custom', path: ['memories', index, field, relationIndex], message: 'Archive relationships must be unique.' });
        }
        seen.add(target);
      }
    }
  }
});

export type MemoryArchive = z.infer<typeof memoryArchiveSchema>;

export interface MemoryArchiveImportOptions {
  folderId?: string | null;
}

export interface MemoryArchiveImportResult {
  imported: number;
  coreDemoted: number;
  relationshipLinksRestored: number;
}

function archiveBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function assertArchiveValueSize(value: unknown): void {
  let text: string | undefined;
  try { text = JSON.stringify(value); }
  catch { throw new Error('Memory archive is not serializable JSON.'); }
  if (typeof text !== 'string') throw new Error('Memory archive format or records are invalid.');
  if (archiveBytes(text) > MEMORY_ARCHIVE_MAX_BYTES) throw new Error('Memory archive exceeds the import size limit.');
}

function assertTargetFolder(folderId: string | null | undefined): string | null {
  const value = folderId?.trim() ?? '';
  if (value.length > 256) throw new Error('Memory archive target folder is invalid.');
  return value || null;
}

function importedKind(kind: MemoryKind): MemoryKind {
  return kind === 'CORE' ? 'CONTEXTUAL' : kind;
}

function exportRelationships(ids: readonly string[], idMap: ReadonlyMap<string, string>, selfArchiveId: string): string[] {
  const mapped: string[] = [];
  for (const id of ids) {
    const archiveId = idMap.get(id);
    if (!archiveId || archiveId === selfArchiveId || mapped.includes(archiveId)) continue;
    mapped.push(archiveId);
  }
  return mapped;
}

/**
 * Build a self-contained portable projection. The archive-local identifiers are
 * deterministic only within this export and have no authority in the durable
 * store. Links to records outside the exported set are intentionally omitted.
 */
export function createMemoryArchive(memories: readonly DurableMemory[], exportedAt = Date.now()): MemoryArchive {
  if (memories.length > MEMORY_ARCHIVE_MAX_RECORDS) throw new Error('Memory archive exceeds the record limit.');
  const seenDurableIds = new Set<string>();
  for (const memory of memories) {
    if (seenDurableIds.has(memory.id)) throw new Error('Memory archive cannot export duplicate durable records.');
    seenDurableIds.add(memory.id);
  }

  const idMap = new Map(memories.map((memory, index) => [memory.id, `memory-${index + 1}`] as const));
  const raw = {
    format: MEMORY_ARCHIVE_FORMAT,
    version: MEMORY_ARCHIVE_VERSION,
    exportedAt,
    memories: memories.map((memory) => {
      const archiveId = idMap.get(memory.id)!;
      return {
        archiveId,
        kind: memory.kind,
        title: memory.title,
        body: memory.body,
        observedAt: memory.observedAt,
        confidence: memory.confidence,
        importance: memory.importance,
        lifecycle: memory.lifecycle,
        originSource: memory.source.source,
        tags: [...memory.tags],
        related: exportRelationships(memory.relatedMemoryIds, idMap, archiveId),
        supporting: exportRelationships(memory.supportingMemoryIds, idMap, archiveId),
        conflicting: exportRelationships(memory.conflictingMemoryIds, idMap, archiveId),
        supersedes: exportRelationships(memory.supersedes, idMap, archiveId),
        supersededBy: exportRelationships(memory.supersededBy, idMap, archiveId),
        expiresAt: memory.expiresAt,
        pinned: memory.pinned === true,
      };
    }),
  };
  const parsed = memoryArchiveSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Could not create a valid memory archive.');
  return parsed.data;
}

export function serializeMemoryArchive(memories: readonly DurableMemory[], exportedAt = Date.now()): string {
  const text = JSON.stringify(createMemoryArchive(memories, exportedAt), null, 2);
  if (archiveBytes(text) > MEMORY_ARCHIVE_MAX_BYTES) throw new Error('Memory archive exceeds the export size limit.');
  return text;
}

export function parseMemoryArchiveText(text: string): MemoryArchive {
  if (archiveBytes(text) > MEMORY_ARCHIVE_MAX_BYTES) throw new Error('Memory archive exceeds the import size limit.');
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch { throw new Error('Memory archive is not valid JSON.'); }
  const parsed = memoryArchiveSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Memory archive format or records are invalid.');
  return parsed.data;
}

function remapRelationships(ids: readonly string[], idMap: ReadonlyMap<string, string>, selfId: string): string[] {
  const mapped: string[] = [];
  for (const archiveId of ids) {
    const newId = idMap.get(archiveId);
    if (!newId || newId === selfId || mapped.includes(newId)) continue;
    mapped.push(newId);
  }
  return mapped;
}

/**
 * Import an already-parsed or external archive into the one canonical memory
 * table. Archive-local IDs, source category and relationship references are
 * data only. New durable IDs are generated by saveMemory; scope, provenance,
 * timestamps and autonomy consent are application-owned. All writes and link
 * restoration share one transaction, so a failure cannot leave a partial bank.
 */
export async function importMemoryArchive(value: unknown, options: MemoryArchiveImportOptions = {}): Promise<MemoryArchiveImportResult> {
  assertArchiveValueSize(value);
  const archive = memoryArchiveSchema.safeParse(value);
  if (!archive.success) throw new Error('Memory archive format or records are invalid.');
  const folderId = assertTargetFolder(options.folderId);
  const now = Date.now();
  let coreDemoted = 0;
  let relationshipLinksRestored = 0;

  await runMemoryMutationTransaction(async () => {
    const idMap = new Map<string, string>();
    const staged: Array<{ original: MemoryArchive['memories'][number]; saved: DurableMemory }> = [];

    for (const original of archive.data.memories) {
      const kind = importedKind(original.kind);
      if (kind !== original.kind) coreDemoted += 1;
      const saved = await saveMemory({
        kind,
        title: original.title,
        body: original.body,
        observedAt: original.observedAt,
        confidence: original.confidence,
        importance: original.importance,
        lifecycle: original.lifecycle,
        source: {
          source: 'import',
          createdAt: now,
          note: `archive-v${MEMORY_ARCHIVE_VERSION}:${original.originSource}:${original.archiveId}`,
        },
        tags: original.tags,
        folderId,
        expiresAt: original.expiresAt,
        pinned: original.pinned === true,
        autonomyContext: false,
      });
      idMap.set(original.archiveId, saved.id);
      staged.push({ original, saved });
    }

    for (const { original, saved } of staged) {
      const relationships = {
        relatedMemoryIds: remapRelationships(original.related, idMap, saved.id),
        supportingMemoryIds: remapRelationships(original.supporting, idMap, saved.id),
        conflictingMemoryIds: remapRelationships(original.conflicting, idMap, saved.id),
        supersedes: remapRelationships(original.supersedes, idMap, saved.id),
        supersededBy: remapRelationships(original.supersededBy, idMap, saved.id),
      };
      relationshipLinksRestored += Object.values(relationships).reduce((sum, ids) => sum + ids.length, 0);
      await updateMemory(saved.id, relationships);
    }
  });

  return { imported: archive.data.memories.length, coreDemoted, relationshipLinksRestored };
}
