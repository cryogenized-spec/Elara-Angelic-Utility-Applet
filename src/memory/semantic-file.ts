import { z } from 'zod';
import { db } from '../persistence/conversation';
import {
  SEMANTIC_ALIAS_MAX_LENGTH,
  SEMANTIC_LABEL_MAX_LENGTH,
  SEMANTIC_MAX_ALIASES,
  SEMANTIC_CONCEPT_KINDS,
  semanticIdentityOverlaps,
  type SemanticConceptKind,
} from './semantic-entities';

/**
 * Semantic memory files (companion continuity Pass 3) — the "filing cabinet".
 *
 * A file is a strictly derived, bounded synthesized view over canonical
 * `db.memories` records. It is an index, not an authority:
 *
 * - every file references one or more canonical memory IDs;
 * - the file can be rebuilt deterministically from those records;
 * - canonical recall, lookup, lifecycle, organic formation and archive paths
 *   never read this table, so synthesized prose cannot enter the prompt as
 *   evidence through any existing route;
 * - deleting or rebuilding a file never touches the underlying observations.
 *
 * Writes are compare-and-write on a monotonic per-file `version` inside a
 * Dexie transaction, so a stale rebuild cannot clobber newer content.
 */

export const SEMANTIC_FILE_KINDS = SEMANTIC_CONCEPT_KINDS;
export type SemanticFileKind = SemanticConceptKind;

export const SEMANTIC_SUMMARY_MAX_LENGTH = 400;
export const SEMANTIC_OBSERVATION_MAX_LENGTH = 200;
export const SEMANTIC_MAX_RECENT_OBSERVATIONS = 4;
export const SEMANTIC_MAX_OPEN_CONFLICTS = 3;
export const SEMANTIC_MAX_SOURCE_REFERENCES = 64;
/** The cabinet is bounded: navigation, not archival completeness. */
export const SEMANTIC_MAX_FILES = 200;

export const semanticMemoryFileSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(SEMANTIC_FILE_KINDS),
  title: z.string().min(1).max(SEMANTIC_LABEL_MAX_LENGTH),
  aliases: z.array(z.string().min(1).max(SEMANTIC_ALIAS_MAX_LENGTH)).max(SEMANTIC_MAX_ALIASES).default([]),
  summary: z.string().min(1).max(SEMANTIC_SUMMARY_MAX_LENGTH),
  recentObservations: z.array(z.string().min(1).max(SEMANTIC_OBSERVATION_MAX_LENGTH)).max(SEMANTIC_MAX_RECENT_OBSERVATIONS).default([]),
  openConflicts: z.array(z.string().min(1).max(SEMANTIC_OBSERVATION_MAX_LENGTH)).max(SEMANTIC_MAX_OPEN_CONFLICTS).default([]),
  sourceMemoryIds: z.array(z.string().min(1).max(128)).min(1).max(SEMANTIC_MAX_SOURCE_REFERENCES),
  updatedAt: z.number().finite(),
  generatedAt: z.number().finite(),
  version: z.number().int().positive(),
}).strict();

export type SemanticMemoryFile = z.infer<typeof semanticMemoryFileSchema>;

type SemanticFileTable = {
  put(value: SemanticMemoryFile): Promise<unknown>;
  get(key: string): Promise<SemanticMemoryFile | undefined>;
  delete(key: string): Promise<unknown>;
  count(): Promise<number>;
  toArray(): Promise<SemanticMemoryFile[]>;
};

function table(): SemanticFileTable {
  return db.semanticMemories as unknown as SemanticFileTable;
}

function validate(record: SemanticMemoryFile): SemanticMemoryFile {
  const parsed = semanticMemoryFileSchema.safeParse(record);
  if (!parsed.success) throw new Error('Invalid semantic memory file.');
  return parsed.data;
}

export function createSemanticFileId(): string {
  return `semantic_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Functional read over the derived cabinet. Malformed rows are quarantined
 * from projection without suppressing unrelated healthy files, mirroring the
 * canonical memory read policy.
 */
export async function listSemanticFiles(): Promise<SemanticMemoryFile[]> {
  const valid: SemanticMemoryFile[] = [];
  for (const record of await table().toArray()) {
    const parsed = semanticMemoryFileSchema.safeParse(record);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export async function getSemanticFile(id: string): Promise<SemanticMemoryFile | undefined> {
  const record = await table().get(id);
  return record ? validate(record) : undefined;
}

/**
 * Compare-and-write on `expectedVersion` inside one transaction.
 *
 * - creating (expectedVersion 0) fails if the file already exists;
 * - updating (expectedVersion > 0) fails closed when the current version
 *   differs, so a stale rebuild can never overwrite newer content;
 * - content that did not change is not written and the version does not
 *   advance, so repeated rebuilds converge.
 */
export async function writeSemanticFile(file: SemanticMemoryFile, expectedVersion: number): Promise<{ file: SemanticMemoryFile; changed: boolean }> {
  return db.transaction('rw', db.semanticMemories, async () => {
    const current = await table().get(file.id);
    if (expectedVersion === 0 && current) throw new Error('Semantic memory file already exists.');
    if (expectedVersion === 0 && (await table().count()) >= SEMANTIC_MAX_FILES) throw new Error('Semantic memory cabinet capacity reached.');
    // Recheck identity for both creates and edits in the write transaction.
    // Concurrent creates, renames and alias edits must not make resolution ambiguous.
    for (const existing of await table().toArray()) {
      const parsed = semanticMemoryFileSchema.safeParse(existing);
      if (parsed.success && parsed.data.id !== file.id && (semanticIdentityOverlaps(parsed.data, file) || (parsed.data.kind === file.kind && file.kind.startsWith('you-')))) {
        throw new Error('A semantic memory file with overlapping identity already exists.');
      }
    }
    if (expectedVersion === 0) {
      const stored = validate(file);
      await table().put(stored);
      return { file: stored, changed: true };
    }
    if (!current) throw new Error('Semantic memory file does not exist.');
    if (current.version !== expectedVersion) throw new Error('Stale semantic memory file update rejected.');
    const currentValid = validate(current);
    const identical = currentValid.title === file.title
      && currentValid.summary === file.summary
      && currentValid.kind === file.kind
      && currentValid.aliases.join('\u0000') === file.aliases.join('\u0000')
      && currentValid.recentObservations.join('\u0000') === file.recentObservations.join('\u0000')
      && currentValid.openConflicts.join('\u0000') === file.openConflicts.join('\u0000')
      && currentValid.sourceMemoryIds.join('\u0000') === file.sourceMemoryIds.join('\u0000')
      && currentValid.updatedAt === file.updatedAt;
    if (identical) return { file: currentValid, changed: false };
    const stored = validate({ ...file, version: expectedVersion + 1 });
    await table().put(stored);
    return { file: stored, changed: true };
  });
}

/**
 * Human-facing "clear this filing" action. Removes the derived view only;
 * every underlying canonical observation remains intact and recoverable by
 * rebuild. This is never a memory-delete authority.
 */
export async function deleteSemanticFile(id: string): Promise<void> {
  await db.transaction('rw', db.semanticMemories, async () => {
    const current = await table().get(id);
    if (!current) throw new Error('Semantic memory file does not exist.');
    validate(current);
    await table().delete(id);
  });
}
