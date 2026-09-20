import { z } from 'zod';
import {
  MEMORY_CATEGORY_KEYS,
  type MemoryBehaviorPreferences,
  type MemoryRememberingStyle,
} from '../domain/preferences';
import { loadFolderState } from '../persistence/folders';
import { loadMemoryBehaviorPreferences, withMemoryBehaviorReadLease } from '../persistence/preferences';
import { consolidateObservation, recordObservation } from './observation';
import { findExactEvidenceSupportTarget } from './lifecycle';
import { runMemoryMutationTransaction } from './store';
import { containsCredentialMaterial, sensitiveMemoryCategoryHints } from './safety';

export const ORGANIC_MEMORY_DOMAINS = [
  'preference',
  'persistent_fact',
  'project_decision',
  'commitment',
  'recurring_context',
  'shared_event',
] as const;

export const ORGANIC_MEMORY_SALIENCES = ['low', 'medium', 'high'] as const;
export type OrganicMemorySalience = (typeof ORGANIC_MEMORY_SALIENCES)[number];

export const MAX_ORGANIC_CANDIDATES = 3;
export const MAX_ORGANIC_EVIDENCE_CHARS = 500;
export const MAX_ORGANIC_INPUT_CHARS = 6_000;
export const ORGANIC_OBSERVATION_CONFIDENCE = 0.6;
export const ORGANIC_OBSERVATION_IMPORTANCE = 0.35;

export const organicMemoryCandidateSchema = z.object({
  domain: z.enum(ORGANIC_MEMORY_DOMAINS),
  category: z.enum(MEMORY_CATEGORY_KEYS),
  salience: z.enum(ORGANIC_MEMORY_SALIENCES),
  evidence: z.string().min(1).max(MAX_ORGANIC_EVIDENCE_CHARS),
}).strict();

export const organicMemoryExtractionSchema = z.object({
  candidates: z.array(organicMemoryCandidateSchema).max(MAX_ORGANIC_CANDIDATES),
}).strict();

export type OrganicMemoryDomain = z.infer<typeof organicMemoryCandidateSchema>['domain'];
export type OrganicMemoryCandidate = z.infer<typeof organicMemoryCandidateSchema>;
export type OrganicMemoryExtractor = (boundedUserMessage: string, signal?: AbortSignal) => Promise<unknown>;

export interface ObservePersistedTurnRequest {
  conversationId: string;
  messageId: string;
  userMessage: string;
  extractor: OrganicMemoryExtractor;
  signal?: AbortSignal;
  isMutationAllowed?: () => boolean;
  /** Deliberate memory work already owns the turn's memory effects. */
  usedMemoryTool?: boolean;
  /** Regenerated response variants must not re-observe the same user evidence. */
  responseVariant?: number;
}

export interface OrganicObservationResult {
  status: 'skipped' | 'empty' | 'recorded' | 'unavailable';
  count: number;
}

const TRIVIAL_MESSAGES = new Set([
  'ok', 'okay', 'k', 'yes', 'yep', 'yeah', 'no', 'nope', 'thanks', 'thank you', 'cool', 'great', 'nice', 'sure', 'done', 'got it',
]);

const DOMAIN_TITLES: Readonly<Record<OrganicMemoryDomain, string>> = {
  preference: 'Observed preference',
  persistent_fact: 'Observed persistent fact',
  project_decision: 'Observed project decision',
  commitment: 'Observed commitment',
  recurring_context: 'Observed recurring context',
  shared_event: 'Observed shared event',
};

const STYLE_MIN_SALIENCE: Readonly<Record<MemoryRememberingStyle, number>> = {
  'explicit-only': Number.POSITIVE_INFINITY,
  selective: 2,
  natural: 1,
  attentive: 0,
};

const SALIENCE_RANK: Readonly<Record<OrganicMemorySalience, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function rememberingStyleAllowsSalience(
  style: MemoryRememberingStyle,
  salience: OrganicMemorySalience,
): boolean {
  return SALIENCE_RANK[salience] >= STYLE_MIN_SALIENCE[style];
}

function candidateAllowedByBehavior(
  candidate: OrganicMemoryCandidate,
  behavior: MemoryBehaviorPreferences,
): boolean {
  if (!behavior.enabled || behavior.rememberingStyle === 'explicit-only') return false;
  if (!rememberingStyleAllowsSalience(behavior.rememberingStyle, candidate.salience)) return false;
  if (!behavior.categories[candidate.category]) return false;

  const sensitiveHints = sensitiveMemoryCategoryHints(candidate.evidence);
  // Ambiguous multi-sensitive spans and category mismatches fail closed. A
  // user can still retain such material deliberately through confirmed memory.
  if (sensitiveHints.length > 1) return false;
  if (sensitiveHints.length === 1 && sensitiveHints[0] !== candidate.category) return false;
  return sensitiveHints.every((category) => behavior.categories[category]);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function boundedOrganicUserMessage(userMessage: string): string {
  return userMessage.trim().slice(0, MAX_ORGANIC_INPUT_CHARS);
}

export function shouldInspectUserMessage(userMessage: string): boolean {
  const bounded = boundedOrganicUserMessage(userMessage);
  if (bounded.length < 12) return false;
  const normalized = bounded.toLocaleLowerCase().replace(/[.!?,;:]+$/g, '').trim();
  return !TRIVIAL_MESSAGES.has(normalized);
}

function acceptedCandidates(raw: unknown, fullUserMessage: string): OrganicMemoryCandidate[] | null {
  const parsed = organicMemoryExtractionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const accepted = new Map<string, OrganicMemoryCandidate>();
  for (const candidate of parsed.data.candidates) {
    // The classifier may point only at literal user-authored evidence. It never
    // gets to paraphrase a fact into existence.
    if (!fullUserMessage.includes(candidate.evidence)) continue;
    if (containsCredentialMaterial(candidate.evidence)) continue;

    const key = `${candidate.domain}\u0000${candidate.category}\u0000${candidate.evidence}`;
    const existing = accepted.get(key);
    // Duplicate classifier nominations with conflicting salience collapse to
    // the more conservative value. Repetition can never inflate retention.
    if (!existing || SALIENCE_RANK[candidate.salience] < SALIENCE_RANK[existing.salience]) {
      accepted.set(key, candidate);
    }
  }
  return [...accepted.values()];
}

function mutationGuard(request: ObservePersistedTurnRequest): () => boolean {
  return () => !request.signal?.aborted && (request.isMutationAllowed?.() ?? true);
}

/**
 * Inspect one already-persisted user turn and, at most, record bounded
 * MICRO_OBSERVATION evidence. The extractor is a classifier/span selector;
 * application code owns wording, type, scope, provenance and write authority.
 *
 * Phase 4 may consolidate only deterministic support: another memory must have
 * the same canonical folder scope, the same domain tag, and text-equivalent
 * user evidence after Unicode/case/whitespace normalization. No semantic model
 * judges support/conflict/supersession in the automatic path.
 *
 * Failure is deliberately non-fatal to chat durability. The caller can keep
 * the composer locked while awaiting this result, then continue regardless of
 * `unavailable`.
 */
export async function observePersistedTurn(request: ObservePersistedTurnRequest): Promise<OrganicObservationResult> {
  if (request.usedMemoryTool || (request.responseVariant ?? 1) > 1 || !request.conversationId.trim() || !request.messageId.trim()) {
    return { status: 'skipped', count: 0 };
  }

  let behavior;
  try {
    behavior = await loadMemoryBehaviorPreferences();
  } catch {
    // Preference authority is unavailable: automatic persistence fails closed.
    return { status: 'unavailable', count: 0 };
  }
  if (!behavior.enabled || behavior.rememberingStyle === 'explicit-only') {
    return { status: 'skipped', count: 0 };
  }

  if (!shouldInspectUserMessage(request.userMessage)) return { status: 'skipped', count: 0 };

  const isMutationAllowed = mutationGuard(request);
  if (!isMutationAllowed()) return { status: 'skipped', count: 0 };

  let raw: unknown;
  try {
    raw = await request.extractor(boundedOrganicUserMessage(request.userMessage), request.signal);
  } catch {
    return { status: 'unavailable', count: 0 };
  }
  if (!isMutationAllowed()) return { status: 'skipped', count: 0 };

  const candidates = acceptedCandidates(raw, request.userMessage);
  if (candidates === null) return { status: 'unavailable', count: 0 };
  if (!candidates.length) return { status: 'empty', count: 0 };

  try {
    const folderState = await loadFolderState();
    const folderId = folderState.assignments[request.conversationId] ?? null;
    const preparedCandidates = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      evidenceFingerprint: await sha256Hex(candidate.evidence),
    })));
    if (!isMutationAllowed()) return { status: 'skipped', count: 0 };

    // Extraction can take seconds and preferences are cross-tab mutable.
    // Re-read the authoritative policy immediately before the write and hold a
    // shared cross-tab lease through the transaction. Preference writes take
    // the exclusive side of this same lock.
    return await withMemoryBehaviorReadLease(async () => {
      const currentBehavior = await loadMemoryBehaviorPreferences();
      if (!currentBehavior.enabled || currentBehavior.rememberingStyle === 'explicit-only') {
        return { status: 'skipped', count: 0 };
      }
      if (!isMutationAllowed()) return { status: 'skipped', count: 0 };

      const eligibleCandidates = preparedCandidates.filter(({ candidate }) => candidateAllowedByBehavior(candidate, currentBehavior));
      if (!eligibleCandidates.length) return { status: 'empty', count: 0 };

      await runMemoryMutationTransaction(async () => {
        for (const { candidate, evidenceFingerprint } of eligibleCandidates) {
          const context = {
            actor: 'model' as const,
            conversationId: request.conversationId,
            messageId: request.messageId,
            folderId,
            idempotencyKey: `organic:${request.conversationId}:${request.messageId}:${candidate.domain}:sha256:${evidenceFingerprint}`,
            isMutationAllowed,
          };
          const observation = await recordObservation(
            {
              title: DOMAIN_TITLES[candidate.domain],
              body: candidate.evidence,
              tags: ['organic', `domain:${candidate.domain}`, `category:${candidate.category}`, `salience:${candidate.salience}`],
              confidence: ORGANIC_OBSERVATION_CONFIDENCE,
              importance: ORGANIC_OBSERVATION_IMPORTANCE,
            },
            context,
          );

          const target = await findExactEvidenceSupportTarget(observation);
          if (target) await consolidateObservation(observation.id, target.id, 'support', context);
        }
      }, isMutationAllowed);
      return { status: 'recorded', count: eligibleCandidates.length };
    });
  } catch {
    return { status: 'unavailable', count: 0 };
  }
}
