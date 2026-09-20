import { z } from 'zod';
import type { MemoryCategoryKey } from '../domain/preferences';
import { containsCredentialMaterial, sensitiveMemoryCategoryHints } from './safety';
import {
  SEMANTIC_MAX_OPEN_CONFLICTS,
  SEMANTIC_MAX_RECENT_OBSERVATIONS,
  SEMANTIC_OBSERVATION_MAX_LENGTH,
  SEMANTIC_SUMMARY_MAX_LENGTH,
} from './semantic-file';
import {
  SEMANTIC_ALIAS_MAX_LENGTH,
  SEMANTIC_MAX_ALIASES,
  normalizeIdentityDisplay,
  normalizeIdentityKey,
} from './semantic-entities';

/**
 * Bounded synthesis for semantic files (Pass 3).
 *
 * The synthesizer is a constrained model call: no tools, no durable-memory
 * projection, bounded input (one concept + a bounded evidence window). The
 * application validates every field and fails closed:
 *
 * - unsupported verbatim claims (recent observations / conflict excerpts
 *   that are not exact substrings of the provided canonical evidence) are
 *   rejected, so provenance survives synthesis;
 * - a summary with no meaningful lexical overlap with the evidence is
 *   rejected as unsupported;
 * - credential-shaped and policy-disabled sensitive material is rejected;
 * - aliases are normalized and bounded; the model never chooses source
 *   references — those are application-owned.
 */

export interface SemanticSynthesisEvidenceRecord {
  id: string;
  title: string;
  body: string;
  conflicting: boolean;
  volatile: boolean;
}

export type SemanticSynthesisExtractor = (boundedInput: string, signal?: AbortSignal) => Promise<unknown>;

export const semanticSynthesisOutputSchema = z.object({
  summary: z.string().min(1).max(SEMANTIC_SUMMARY_MAX_LENGTH),
  recentObservations: z.array(z.string().min(1).max(SEMANTIC_OBSERVATION_MAX_LENGTH)).max(SEMANTIC_MAX_RECENT_OBSERVATIONS).default([]),
  openConflicts: z.array(z.string().min(1).max(SEMANTIC_OBSERVATION_MAX_LENGTH)).max(SEMANTIC_MAX_OPEN_CONFLICTS).default([]),
  aliases: z.array(z.string().min(1).max(SEMANTIC_ALIAS_MAX_LENGTH)).max(SEMANTIC_MAX_ALIASES).default([]),
}).strict();

export type SemanticSynthesisOutput = z.infer<typeof semanticSynthesisOutputSchema>;

export interface ValidatedSemanticSynthesis {
  summary: string;
  recentObservations: string[];
  openConflicts: string[];
  aliases: string[];
}

const SUMMARY_OVERLAP_STOPWORDS = new Set([
  'able', 'about', 'above', 'across', 'after', 'again', 'against', 'also', 'along', 'among',
  'another', 'any', 'anyone', 'anything', 'around', 'are', 'as', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'can', 'cannot', 'could', 'did', 'does', 'doing',
  'done', 'down', 'during', 'each', 'either', 'else', 'even', 'every', 'everyone', 'everything',
  'few', 'find', 'found', 'from', 'further', 'get', 'gets', 'getting', 'got', 'had', 'has',
  'have', 'having', 'he', 'here', 'her', 'hers', 'him', 'his', 'how', 'into', 'is', 'just',
  'keep', 'keeps', 'kept', 'know', 'known', 'let', 'lets', 'likely', 'made', 'make', 'makes',
  'many', 'may', 'might', 'more', 'most', 'much', 'must', 'near', 'need', 'needs', 'never',
  'nothing', 'often', 'one', 'onto', 'only', 'other', 'others', 'ought', 'our', 'ours', 'over',
  'quite', 'rather', 'said', 'says', 'seen', 'seem', 'seems', 'several', 'she', 'should',
  'since', 'some', 'something', 'so', 'still', 'such', 'take', 'takes', 'taken', 'tell',
  'tells', 'than', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'though', 'through', 'under', 'until', 'upon', 'use', 'used', 'uses', 'very', 'want',
  'wants', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'you', 'your', 'yours',
]);

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      .filter((token) => !SUMMARY_OVERLAP_STOPWORDS.has(token)),
  );
}

function isVerbatimInEvidence(span: string, evidence: readonly SemanticSynthesisEvidenceRecord[]): boolean {
  const needle = span.trim();
  if (!needle) return false;
  return evidence.some((record) => record.body.includes(needle) || record.title.includes(needle));
}

/**
 * Validate one raw synthesis against the bounded evidence window.
 * Returns null (fail closed) when any invariant is violated.
 */
export function validateSemanticSynthesis(
  raw: unknown,
  evidence: readonly SemanticSynthesisEvidenceRecord[],
  conceptTitle: string,
  categories: Readonly<Record<MemoryCategoryKey, boolean>>,
): ValidatedSemanticSynthesis | null {
  if (!evidence.length) return null;
  const parsed = semanticSynthesisOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { summary, recentObservations, openConflicts, aliases } = parsed.data;

  const prose = [summary, ...recentObservations, ...openConflicts, ...aliases].join('\n');
  if (containsCredentialMaterial(prose)) return null;

  for (const hint of sensitiveMemoryCategoryHints(prose)) {
    if (!categories[hint]) return null;
  }

  // A summary must be grounded in the evidence it summarizes.
  const evidenceTokens = new Set<string>();
  for (const record of evidence) {
    for (const token of meaningfulTokens(`${record.title} ${record.body}`)) evidenceTokens.add(token);
  }
  if (![...meaningfulTokens(summary)].some((token) => evidenceTokens.has(token))) return null;

  for (const observation of recentObservations) {
    if (!isVerbatimInEvidence(observation, evidence)) return null;
  }
  for (const conflict of openConflicts) {
    if (!isVerbatimInEvidence(conflict, evidence)) return null;
  }
  if (evidence.some((record) => record.conflicting) && openConflicts.length === 0) return null;

  const titleKey = normalizeIdentityKey(conceptTitle);
  const seen = new Set<string>([titleKey]);
  const normalizedAliases: string[] = [];
  for (const alias of aliases) {
    const display = normalizeIdentityDisplay(alias);
    const key = normalizeIdentityKey(display);
    if (!display || !key || key === titleKey || seen.has(key)) continue;
    if (containsCredentialMaterial(display)) return null;
    seen.add(key);
    normalizedAliases.push(display);
    if (normalizedAliases.length >= SEMANTIC_MAX_ALIASES) break;
  }

  return { summary: summary.trim(), recentObservations, openConflicts, aliases: normalizedAliases };
}

/**
 * Build the bounded synthesizer input. The evidence window is the only
 * durable content the model ever sees for this surface.
 */
export function buildSemanticSynthesisInput(
  concept: { kind: string; title: string; aliases: readonly string[] },
  evidence: readonly SemanticSynthesisEvidenceRecord[],
  previous?: { summary?: string; recentObservations?: readonly string[]; openConflicts?: readonly string[] },
): string {
  const lines: string[] = [
    `CONCEPT: kind=${concept.kind} title=${concept.title}`,
    concept.aliases.length ? `KNOWN ALIASES: ${concept.aliases.join(', ')}` : '',
    `CANONICAL EVIDENCE (${evidence.length} records):`,
    ...evidence.flatMap((record) => [
      `[${record.id}] (conflicting=${record.conflicting ? 'yes' : 'no'}, volatile=${record.volatile ? 'yes' : 'no'}) ${record.title}: ${record.body}`,
    ]),
  ];
  if (previous?.summary) lines.push(`PREVIOUS SUMMARY (may be stale): ${previous.summary}`);
  if (previous?.recentObservations?.length) lines.push(`PREVIOUS RECENT OBSERVATIONS: ${previous.recentObservations.join(' | ')}`);
  if (previous?.openConflicts?.length) lines.push(`PREVIOUS OPEN CONFLICTS: ${previous.openConflicts.join(' | ')}`);
  return lines.filter(Boolean).join('\n');
}
