import type { DurableMemory } from './types';
import { normalizeIdentityKey } from './semantic-entities';
import type { SemanticMemoryFile, SemanticFileKind } from './semantic-file';

/**
 * Deterministic evidence selection for semantic files (Pass 3).
 *
 * One selection function feeds synthesis, freshness and retrieval fallback so
 * those surfaces cannot drift apart. Selection is pure and total: the same
 * canonical records and concept always produce the same bounded evidence set
 * and signature. No model judges relevance here.
 */

export const SEMANTIC_EVIDENCE_MAX_RECORDS = 16;
export const SEMANTIC_EVIDENCE_MAX_CHARS = 8_000;
/** Identity keys shorter than this never drive lexical matching (e.g. a "Z" alias). */
const MIN_LEXICAL_IDENTITY_KEY_LENGTH = 2;

const YOU_PROFILE_TAGS = new Set(['category:personal_facts', 'domain:persistent_fact']);
const YOU_PREFERENCE_TAGS = new Set(['category:likes_dislikes', 'domain:preference']);

function conceptIdentityKeys(file: Pick<SemanticMemoryFile, 'title' | 'aliases'>): string[] {
  return [...new Set(
    [normalizeIdentityKey(file.title), ...file.aliases.map(normalizeIdentityKey)]
      .map((key) => key.trim())
      .filter((key) => key.length >= MIN_LEXICAL_IDENTITY_KEY_LENGTH),
  )];
}

function matchesConcept(memory: DurableMemory, kind: SemanticFileKind, keys: readonly string[]): boolean {
  if (kind === 'you-profile' || kind === 'you-preferences') {
    const allowed = kind === 'you-profile' ? YOU_PROFILE_TAGS : YOU_PREFERENCE_TAGS;
    return memory.tags.some((tag) => allowed.has(tag));
  }
  const haystack = normalizeIdentityKey(`${memory.title} ${memory.body}`);
  return keys.some((key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(haystack);
  });
}

export interface SemanticEvidenceSelection {
  memories: DurableMemory[];
  maxSourceUpdatedAt: number;
  /** Deterministic fingerprint of the selected canonical set (IDs + updatedAt). */
  signatureInput: string;
}

/**
 * Select the bounded canonical evidence that grounds one concept.
 *
 * Eligibility mirrors what normal recall may see (active, not archived,
 * expired or superseded), plus: the record must be a live, schema-valid
 * canonical row already passed by the caller. Superseded history, archived
 * rows and dormant evidence deliberately stay out of synthesis; they remain
 * auditable in the Memory Bank and in the underlying records.
 */
export function selectSemanticFileEvidence(
  file: Pick<SemanticMemoryFile, 'kind' | 'title' | 'aliases'>,
  memories: readonly DurableMemory[],
  now: number = Date.now(),
): SemanticEvidenceSelection {
  const keys = conceptIdentityKeys(file);

  const candidates = memories
    .filter((memory) => memory.lifecycle === 'active')
    .filter((memory) => memory.supersededBy.length === 0)
    .filter((memory) => memory.expiresAt === null || memory.expiresAt > now)
    .filter((memory) => matchesConcept(memory, file.kind, keys))
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id));

  const selected: DurableMemory[] = [];
  let characters = 0;
  for (const memory of candidates) {
    const cost = memory.title.length + memory.body.length;
    if (selected.length >= SEMANTIC_EVIDENCE_MAX_RECORDS) break;
    if (selected.length > 0 && characters + cost > SEMANTIC_EVIDENCE_MAX_CHARS) continue;
    selected.push(memory);
    characters += cost;
  }

  return {
    memories: selected,
    maxSourceUpdatedAt: selected.reduce((max, memory) => Math.max(max, memory.updatedAt), 0),
    signatureInput: selected.map((memory) => `${memory.id}:${memory.updatedAt}`).join('\n'),
  };
}

/**
 * Is the file's grounded content stale? A file is stale when the canonical
 * evidence selection no longer matches what it was generated from: a
 * referenced source vanished, changed, or the deterministic selection now
 * differs (bounded window moved).
 */
export function isSemanticFileStale(
  file: SemanticMemoryFile,
  memories: readonly DurableMemory[],
): boolean {
  const byId = new Map(memories.map((memory) => [memory.id, memory] as const));
  const referenced = file.sourceMemoryIds
    .map((id) => byId.get(id))
    .filter((memory): memory is DurableMemory =>
      memory !== undefined
      && memory.lifecycle === 'active'
      && memory.supersededBy.length === 0
      && (memory.expiresAt === null || memory.expiresAt > Date.now()),
    );
  if (referenced.length === 0) return true;

  const selection = selectSemanticFileEvidence(file, memories);
  const currentIds = selection.memories.map((memory) => memory.id).sort();
  const previousIds = file.sourceMemoryIds.slice().sort();
  const idsMatch = currentIds.length === previousIds.length && currentIds.every((id, index) => id === previousIds[index]);
  if (!idsMatch) return true;
  return selection.maxSourceUpdatedAt > file.updatedAt;
}
