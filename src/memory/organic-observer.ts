import { z } from 'zod';
import { loadFolderState } from '../persistence/folders';
import { consolidateObservation, recordObservation } from './observation';
import { findExactEvidenceSupportTarget } from './lifecycle';
import { runMemoryMutationTransaction } from './store';

export const ORGANIC_MEMORY_DOMAINS = [
  'preference',
  'persistent_fact',
  'project_decision',
  'commitment',
  'recurring_context',
  'shared_event',
] as const;

export const MAX_ORGANIC_CANDIDATES = 3;
export const MAX_ORGANIC_EVIDENCE_CHARS = 500;
export const MAX_ORGANIC_INPUT_CHARS = 6_000;
export const ORGANIC_OBSERVATION_CONFIDENCE = 0.6;
export const ORGANIC_OBSERVATION_IMPORTANCE = 0.35;

export const organicMemoryCandidateSchema = z.object({
  domain: z.enum(ORGANIC_MEMORY_DOMAINS),
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

function containsLuhnValidCardNumber(value: string): boolean {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

/**
 * Obvious credential material is never eligible for automatic persistence.
 * This is intentionally narrow: the model prompt supplies the broader privacy
 * policy, while this deterministic gate catches common secret-shaped evidence.
 */
function looksLikeCredential(evidence: string): boolean {
  return /\b(?:password|passcode|pin|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b\s*(?:is|=|:)\s*\S+/i.test(evidence)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(evidence)
    || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(evidence)
    || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(evidence)
    || /\bAIza[0-9A-Za-z_-]{35}\b/.test(evidence)
    || /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(evidence)
    || /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(evidence)
    || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(evidence)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(evidence)
    || containsLuhnValidCardNumber(evidence);
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
  const accepted: OrganicMemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed.data.candidates) {
    // The classifier may point only at literal user-authored evidence. It never
    // gets to paraphrase a fact into existence.
    if (!fullUserMessage.includes(candidate.evidence)) continue;
    if (looksLikeCredential(candidate.evidence)) continue;
    const key = `${candidate.domain}\u0000${candidate.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(candidate);
  }
  return accepted;
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

    await runMemoryMutationTransaction(async () => {
      for (const { candidate, evidenceFingerprint } of preparedCandidates) {
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
            tags: ['organic', `domain:${candidate.domain}`],
            confidence: ORGANIC_OBSERVATION_CONFIDENCE,
            importance: ORGANIC_OBSERVATION_IMPORTANCE,
          },
          context,
        );

        const target = await findExactEvidenceSupportTarget(observation);
        if (target) await consolidateObservation(observation.id, target.id, 'support', context);
      }
    }, isMutationAllowed);
    return { status: 'recorded', count: candidates.length };
  } catch {
    return { status: 'unavailable', count: 0 };
  }
}
