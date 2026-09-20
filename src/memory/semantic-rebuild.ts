import { loadMemoryBehaviorPreferences, withMemoryBehaviorReadLease } from '../persistence/preferences';
import { selectSemanticFileEvidence } from './semantic-evidence';
import { createSemanticFileId, getSemanticFile, listSemanticFiles, writeSemanticFile, type SemanticMemoryFile } from './semantic-file';
import {
  applySemanticEntityMatch,
  normalizeIdentityKey,
  normalizeSemanticProposal,
  resolveSemanticEntity,
  SEMANTIC_MAX_ALIASES,
} from './semantic-entities';
import {
  buildSemanticSynthesisInput,
  validateSemanticSynthesis,
  type SemanticSynthesisExtractor,
} from './semantic-synthesis';
import { deriveMemoryVolatility } from './volatility';
import { listMemories } from './store';
import { containsCredentialMaterial, sensitiveMemoryCategoryHints } from './safety';

/**
 * One-file rebuild for the semantic cabinet (Pass 3).
 *
 * Rebuild is the only way content enters a file:
 *   bounded canonical evidence window -> one bounded synthesis call ->
 *   fail-closed validation -> compare-and-write on the file version.
 *
 * It never mutates `db.memories`, never triggers other rebuilds (no
 * recursive synthesis loops), and fails closed whenever evidence, policy or
 * concurrency state does not match expectations. Repeated rebuilds over
 * unchanged evidence converge: unchanged content does not advance the
 * version.
 */

export type SemanticRebuildStatus = 'created' | 'refreshed' | 'unchanged' | 'rejected' | 'unavailable';

export interface SemanticRebuildResult {
  status: SemanticRebuildStatus;
  file?: SemanticMemoryFile;
}

export interface SemanticRebuildRequest {
  /** Raw proposal (model- or human-supplied). The application normalizes it; malformed input is rejected. */
  proposal: unknown;
  extractor: SemanticSynthesisExtractor;
  signal?: AbortSignal;
}

function mergeConceptAliases(
  base: { title: string; aliases: string[] },
  incoming: readonly string[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>([normalizeIdentityKey(base.title)]);
  for (const alias of [...base.aliases, ...incoming]) {
    const key = normalizeIdentityKey(alias);
    if (!key || key === normalizeIdentityKey(base.title) || seen.has(key)) continue;
    seen.add(key);
    ordered.push(alias.trim());
    if (ordered.length >= SEMANTIC_MAX_ALIASES) break;
  }
  return ordered;
}

export async function rebuildSemanticFile(request: SemanticRebuildRequest): Promise<SemanticRebuildResult> {
  const proposal = normalizeSemanticProposal(request.proposal);
  if (!proposal) return { status: 'rejected' };

  return withMemoryBehaviorReadLease(async () => {
    const behavior = await loadMemoryBehaviorPreferences();
    if (!behavior.enabled || request.signal?.aborted) return { status: 'unavailable' };
    const memories = await listMemories();
    const files = await listSemanticFiles();
    const resolution = resolveSemanticEntity(proposal, files);

    if (resolution.status === 'unresolved') return { status: 'unavailable' };

    let concept = {
      id: createSemanticFileId(),
      kind: proposal.kind,
      title: proposal.label,
      aliases: proposal.aliases,
      version: 0,
    };
    if (resolution.status === 'match') {
      const existing = await getSemanticFile(resolution.fileId);
      if (!existing) return { status: 'unavailable' };
      const upserted = applySemanticEntityMatch(existing, proposal);
      concept = {
        id: existing.id,
        kind: existing.kind,
        title: upserted.title,
        aliases: upserted.aliases,
        version: existing.version,
      };
    }

    const selection = selectSemanticFileEvidence(concept, memories.filter((memory) => {
      const text = `${memory.title}\n${memory.body}`;
      return !containsCredentialMaterial(text)
        && !sensitiveMemoryCategoryHints(text).some((category) => !behavior.categories[category])
        && !Object.entries(behavior.categories).some(([category, enabled]) => !enabled && memory.tags.includes(`category:${category}`));
    }));
    if (!selection.memories.length) {
      if (concept.version === 0) return { status: 'unavailable' };
      // The existing file keeps its last grounded content; nothing new to say.
      return { status: 'unchanged', file: await getSemanticFile(concept.id) };
    }

    const evidence = selection.memories.map((memory) => ({
      id: memory.id,
      title: memory.title,
      body: memory.body,
      conflicting: memory.conflictingMemoryIds.length > 0,
      volatile: deriveMemoryVolatility(memory).requiresRevalidation,
    }));

    let raw: unknown;
    try {
      const existingForInput = concept.version > 0 ? await getSemanticFile(concept.id) : undefined;
      raw = await request.extractor(
        buildSemanticSynthesisInput(
          { kind: concept.kind, title: concept.title, aliases: concept.aliases },
          evidence,
          existingForInput
            ? {
                summary: existingForInput.summary,
                recentObservations: existingForInput.recentObservations,
                openConflicts: existingForInput.openConflicts,
              }
            : undefined,
        ),
        request.signal,
      );
    } catch {
      return { status: 'unavailable' };
    }

    const validated = validateSemanticSynthesis(raw, evidence, concept.title, behavior.categories);
    if (!validated) return { status: 'rejected' };

    const aliases = mergeConceptAliases({ title: concept.title, aliases: concept.aliases }, validated.aliases);
    const now = Date.now();
    const file: SemanticMemoryFile = {
      id: concept.id,
      kind: concept.kind,
      title: concept.title,
      aliases,
      summary: validated.summary,
      recentObservations: validated.recentObservations,
      openConflicts: validated.openConflicts,
      sourceMemoryIds: selection.memories.map((memory) => memory.id),
      updatedAt: selection.maxSourceUpdatedAt,
      generatedAt: now,
      version: concept.version + 1,
    };

    try {
      const written = await writeSemanticFile(file, concept.version);
      return { status: written.changed ? (concept.version > 0 ? 'refreshed' : 'created') : 'unchanged', file: written.file };
    } catch {
      return { status: 'unavailable' };
    }
  });
}
