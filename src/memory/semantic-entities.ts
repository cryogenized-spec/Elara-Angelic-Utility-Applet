import { z } from 'zod';
import { containsCredentialMaterial } from './safety';

/**
 * Entity and concept identity for the semantic organization layer.
 *
 * This module owns *identity only*: whether a bounded link proposal points at
 * an existing concept or a genuinely new one. It confers no epistemic weight —
 * nothing here changes confidence, importance, kind, lifecycle or retrieval
 * eligibility of canonical memory records. The closed concept taxonomy is
 * application-defined; arbitrary top-level authority classes cannot be
 * proposed or created.
 *
 * Identity rules:
 * - exact normalized (NFKC, whitespace-collapsed, casefolded) title/alias
 *   equality is the only merge path;
 * - fuzzy similarity alone never merges two concepts;
 * - a proposal overlapping multiple existing concepts, or overlapping a
 *   concept of a different kind, fails safely as unresolved;
 * - a correction renames the concept and preserves the previous title as a
 *   historical alias;
 * - you-profile / you-preferences are singletons per kind.
 */

export const SEMANTIC_CONCEPT_KINDS = [
  'you-profile',
  'you-preferences',
  'person',
  'area',
  'project',
  'topic',
] as const;
export type SemanticConceptKind = (typeof SEMANTIC_CONCEPT_KINDS)[number];

export const SEMANTIC_LABEL_MAX_LENGTH = 80;
export const SEMANTIC_ALIAS_MAX_LENGTH = 64;
export const SEMANTIC_MAX_ALIASES = 8;
export const SEMANTIC_EVIDENCE_REF_MAX_LENGTH = 500;

/** Strict proposal shape. Model or application code may propose; only the application decides. */
export const semanticLinkProposalSchema = z.object({
  kind: z.enum(SEMANTIC_CONCEPT_KINDS),
  canonicalLabel: z.string().min(1).max(SEMANTIC_LABEL_MAX_LENGTH),
  aliases: z.array(z.string().min(1).max(SEMANTIC_ALIAS_MAX_LENGTH)).max(SEMANTIC_MAX_ALIASES).default([]),
  /** Exact span of user-grounded evidence that motivated the proposal. */
  evidenceRef: z.string().min(1).max(SEMANTIC_EVIDENCE_REF_MAX_LENGTH),
}).strict();

export type SemanticLinkProposal = z.infer<typeof semanticLinkProposalSchema>;

export interface NormalizedSemanticProposal {
  kind: SemanticConceptKind;
  label: string;
  aliases: string[];
  evidenceRef: string;
}

/** Existing concept record as far as identity resolution needs it. */
export interface SemanticEntityRecord {
  id: string;
  kind: SemanticConceptKind;
  title: string;
  aliases: string[];
}

const YOU_KINDS = new Set<SemanticConceptKind>(['you-profile', 'you-preferences']);

/** Display normalization: NFKC + whitespace collapse, original casing preserved. */
export function normalizeIdentityDisplay(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Matching key: display normalization plus casefold. */
export function normalizeIdentityKey(value: string): string {
  return normalizeIdentityDisplay(value).toLocaleLowerCase();
}

/**
 * Validate and normalize one proposal. Returns null for anything malformed,
 * credential-shaped, or carrying no usable identity. The application owns the
 * decision; the proposer never does.
 */
export function normalizeSemanticProposal(raw: unknown): NormalizedSemanticProposal | null {
  const parsed = semanticLinkProposalSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { kind, canonicalLabel, aliases, evidenceRef } = parsed.data;

  const label = normalizeIdentityDisplay(canonicalLabel);
  if (!label || !evidenceRef.trim()) return null;
  if (containsCredentialMaterial(label)) return null;

  const seen = new Set<string>([normalizeIdentityKey(label)]);
  const normalizedAliases: string[] = [];
  for (const alias of aliases) {
    const display = normalizeIdentityDisplay(alias);
    const key = normalizeIdentityKey(display);
    if (!display || !key || key === normalizeIdentityKey(label) || seen.has(key)) continue;
    seen.add(key);
    normalizedAliases.push(display);
    if (normalizedAliases.length >= SEMANTIC_MAX_ALIASES) break;
  }
  if (aliases.some((alias) => containsCredentialMaterial(alias))) return null;

  return { kind, label, aliases: normalizedAliases, evidenceRef: evidenceRef.trim() };
}

function identityKeysOf(record: Pick<SemanticEntityRecord, 'title' | 'aliases'>): ReadonlySet<string> {
  return new Set([
    normalizeIdentityKey(record.title),
    ...record.aliases.map(normalizeIdentityKey),
  ].filter(Boolean));
}

export type SemanticEntityResolution =
  | { status: 'match'; fileId: string; renamed: boolean }
  | { status: 'create' }
  | { status: 'unresolved'; reason: 'ambiguous' };

/** True when two concept identity sets share at least one normalized key. */
export function semanticIdentityOverlaps(
  left: Pick<SemanticEntityRecord, 'title' | 'aliases'>,
  right: Pick<SemanticEntityRecord, 'title' | 'aliases'>,
): boolean {
  return [...identityKeysOf(left)].some((key) => identityKeysOf(right).has(key));
}

/**
 * Resolve one normalized proposal against existing concepts.
 *
 * Exact identity-key equality is the only merge path. A proposal that touches
 * more than one same-kind concept, or any concept of a different kind, is
 * ambiguous and stays unresolved: the evidence remains unlinked rather than
 * being attached to a guessed concept.
 */
export function resolveSemanticEntity(
  proposal: NormalizedSemanticProposal,
  existing: readonly SemanticEntityRecord[],
): SemanticEntityResolution {
  if (YOU_KINDS.has(proposal.kind)) {
    const match = existing.find((record) => record.kind === proposal.kind);
    return match ? { status: 'match', fileId: match.id, renamed: false } : { status: 'create' };
  }

  const proposalKeys = identityKeysOf({ title: proposal.label, aliases: proposal.aliases });
  const overlaps = (record: SemanticEntityRecord): boolean =>
    [...identityKeysOf(record)].some((key) => proposalKeys.has(key));

  if (existing.some((record) => record.kind !== proposal.kind && overlaps(record))) {
    return { status: 'unresolved', reason: 'ambiguous' };
  }

  const matches = existing.filter((record) => record.kind === proposal.kind && overlaps(record));
  if (matches.length === 0) return { status: 'create' };
  if (matches.length > 1) return { status: 'unresolved', reason: 'ambiguous' };

  const record = matches[0]!;
  return { status: 'match', fileId: record.id, renamed: normalizeIdentityKey(record.title) !== normalizeIdentityKey(proposal.label) };
}

export interface SemanticEntityUpsert {
  title: string;
  aliases: string[];
  changed: boolean;
}

/**
 * Fold a matched proposal into an existing concept. The concept keeps its
 * stable identity (id/kind are owned by the store, not this result); a
 * correction becomes the new title while the previous title is retained as a
 * historical alias. Alias lists stay bounded and deterministic.
 */
export function applySemanticEntityMatch(
  record: SemanticEntityRecord,
  proposal: NormalizedSemanticProposal,
): SemanticEntityUpsert {
  const ordered: Array<{ display: string; key: string }> = [];
  if (normalizeIdentityKey(record.title) !== normalizeIdentityKey(proposal.label)) {
    ordered.push({ display: normalizeIdentityDisplay(record.title), key: normalizeIdentityKey(record.title) });
  }
  for (const alias of record.aliases) {
    const display = normalizeIdentityDisplay(alias);
    ordered.push({ display, key: normalizeIdentityKey(display) });
  }
  for (const alias of proposal.aliases) {
    const display = normalizeIdentityDisplay(alias);
    ordered.push({ display, key: normalizeIdentityKey(display) });
  }

  const seen = new Set<string>([normalizeIdentityKey(proposal.label)]);
  const merged: string[] = [];
  for (const { display, key } of ordered) {
    if (!key || key === normalizeIdentityKey(proposal.label) || seen.has(key)) continue;
    seen.add(key);
    merged.push(display);
    if (merged.length >= SEMANTIC_MAX_ALIASES) break;
  }

  const changed = normalizeIdentityDisplay(record.title) !== proposal.label || merged.length !== record.aliases.length;
  return { title: proposal.label, aliases: merged, changed };
}
