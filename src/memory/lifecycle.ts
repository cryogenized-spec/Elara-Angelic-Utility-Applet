import type { DurableMemory, MemoryKind } from './types';
import { getMemory, listMemories, updateMemory } from './store';

export const SUPPORT_CONFIDENCE_STEP = 0.08;
export const SUPPORT_IMPORTANCE_STEP = 0.04;
export const SUPPORT_CONFIDENCE_CEILING = 0.92;
export const SUPPORT_IMPORTANCE_CEILING = 0.75;

export const MICRO_TO_EPISODIC_REINFORCEMENTS = 1;
export const EPISODIC_TO_CONTEXTUAL_REINFORCEMENTS = 3;

export const ORGANIC_MICRO_DORMANCY_MS = 90 * 86_400_000;
export const ORGANIC_EPISODIC_DORMANCY_MS = 180 * 86_400_000;
export const ORGANIC_CONTEXTUAL_DORMANCY_MS = 365 * 86_400_000;

const KIND_RANK: Readonly<Record<MemoryKind, number>> = {
  MICRO_OBSERVATION: 0,
  EPISODIC: 1,
  CONTEXTUAL: 2,
  CORE: 3,
};

/** Policy weights use hundredth precision; quantize here so IEEE-754 drift can never alter a lifecycle threshold. */
function boundedPolicyWeight(value: number, ceiling: number): number {
  const bounded = Math.min(ceiling, Math.max(0, value));
  return Math.round(bounded * 100) / 100;
}

function domainTag(memory: DurableMemory): string | undefined {
  return memory.tags.find((tag) => tag.startsWith('domain:'));
}

/**
 * Conservative equivalence for automatic support only. It intentionally does
 * not remove punctuation or paraphrase text: case/Unicode/whitespace variants
 * may converge, semantically similar sentences do not.
 */
export function normalizedEvidenceKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Find a same-scope, same-domain, text-equivalent memory that can safely receive
 * automatic supporting evidence. Superseded, archived, and expired records are
 * never revived or reinforced by the organic path. Established memories win
 * over micro-observations.
 */
export async function findExactEvidenceSupportTarget(observation: DurableMemory): Promise<DurableMemory | undefined> {
  if (observation.kind !== 'MICRO_OBSERVATION') return undefined;
  const domain = domainTag(observation);
  if (!domain) return undefined;
  const evidenceKey = normalizedEvidenceKey(observation.body);
  if (!evidenceKey) return undefined;
  const now = Date.now();

  const candidates = (await listMemories())
    .filter((memory) => memory.id !== observation.id)
    .filter((memory) => memory.lifecycle !== 'archived')
    .filter((memory) => memory.supersededBy.length === 0)
    .filter((memory) => memory.expiresAt === null || memory.expiresAt > now)
    .filter((memory) => memory.folderId === observation.folderId)
    .filter((memory) => domainTag(memory) === domain)
    .filter((memory) => normalizedEvidenceKey(memory.body) === evidenceKey)
    .sort((left, right) => (
      KIND_RANK[right.kind] - KIND_RANK[left.kind]
      || Number(right.lifecycle === 'active') - Number(left.lifecycle === 'active')
      || right.reinforcementCount - left.reinforcementCount
      || right.updatedAt - left.updatedAt
    ));

  return candidates[0];
}

/**
 * Evidence reinforcement changes epistemic weight in small application-owned
 * steps. A superseded target may accumulate historical evidence but can never
 * be automatically reactivated. Expired targets reject new automatic evidence.
 */
export async function reinforceMemoryFromEvidence(id: string): Promise<DurableMemory> {
  const memory = await getMemory(id);
  if (!memory) throw new Error('Memory not found.');
  if (memory.lifecycle === 'archived') throw new Error('Archived memory cannot be automatically reinforced.');
  if (memory.expiresAt !== null && memory.expiresAt <= Date.now()) throw new Error('Expired memory cannot be automatically reinforced.');

  return updateMemory(memory.id, {
    reinforcementCount: memory.reinforcementCount + 1,
    confidence: boundedPolicyWeight(memory.confidence + SUPPORT_CONFIDENCE_STEP, SUPPORT_CONFIDENCE_CEILING),
    importance: boundedPolicyWeight(memory.importance + SUPPORT_IMPORTANCE_STEP, SUPPORT_IMPORTANCE_CEILING),
    lifecycle: memory.supersededBy.length ? 'dormant' : 'active',
  });
}

function shouldDormantForAge(memory: DurableMemory, now: number): boolean {
  if (!memory.tags.includes('organic')) return false;
  const ageMs = Math.max(0, now - memory.updatedAt);

  if (memory.kind === 'MICRO_OBSERVATION') {
    return memory.reinforcementCount === 0 && ageMs >= ORGANIC_MICRO_DORMANCY_MS;
  }
  if (memory.kind === 'EPISODIC') {
    return memory.reinforcementCount < EPISODIC_TO_CONTEXTUAL_REINFORCEMENTS
      && ageMs >= ORGANIC_EPISODIC_DORMANCY_MS;
  }
  if (memory.kind === 'CONTEXTUAL') {
    return memory.confidence < 0.8 && ageMs >= ORGANIC_CONTEXTUAL_DORMANCY_MS;
  }
  return false;
}

/**
 * Apply one conservative lifecycle transition. Conflict blocks automatic
 * promotion; supersession/expiry take precedence; organic evidence can promote
 * only as far as CONTEXTUAL. CORE remains a deliberate/user-owned authority.
 */
export async function applyMemoryLifecyclePolicy(id: string, now = Date.now()): Promise<DurableMemory> {
  let memory = await getMemory(id);
  if (!memory) throw new Error('Memory not found.');
  if (memory.lifecycle === 'archived') return memory;

  if (memory.supersededBy.length > 0 || (memory.expiresAt !== null && memory.expiresAt <= now)) {
    if (memory.lifecycle !== 'dormant') memory = await updateMemory(memory.id, { lifecycle: 'dormant' });
    return memory;
  }

  if (shouldDormantForAge(memory, now)) {
    if (memory.lifecycle !== 'dormant') memory = await updateMemory(memory.id, { lifecycle: 'dormant' });
    return memory;
  }

  if (memory.conflictingMemoryIds.length > 0) return memory;

  if (
    memory.kind === 'MICRO_OBSERVATION'
    && memory.reinforcementCount >= MICRO_TO_EPISODIC_REINFORCEMENTS
    && memory.supportingMemoryIds.length >= MICRO_TO_EPISODIC_REINFORCEMENTS
    && memory.confidence >= 0.68
  ) {
    return updateMemory(memory.id, { kind: 'EPISODIC', lifecycle: 'active' });
  }

  if (
    memory.kind === 'EPISODIC'
    && memory.reinforcementCount >= EPISODIC_TO_CONTEXTUAL_REINFORCEMENTS
    && memory.supportingMemoryIds.length >= EPISODIC_TO_CONTEXTUAL_REINFORCEMENTS
    && memory.confidence >= 0.8
  ) {
    return updateMemory(memory.id, { kind: 'CONTEXTUAL', lifecycle: 'active' });
  }

  return memory;
}

export interface MemoryLifecycleSweepResult {
  reviewed: number;
  changed: number;
  dormant: number;
  promoted: number;
}

/**
 * Explicit maintenance primitive for the Memory Bank / future maintenance pass.
 * It is intentionally not scheduled from chat turns: no hidden second lifecycle
 * controller and no full-store scan on every response.
 */
export async function sweepMemoryLifecycle(now = Date.now()): Promise<MemoryLifecycleSweepResult> {
  const memories = await listMemories();
  let changed = 0;
  let dormant = 0;
  let promoted = 0;

  for (const before of memories) {
    const after = await applyMemoryLifecyclePolicy(before.id, now);
    if (after.kind !== before.kind || after.lifecycle !== before.lifecycle) {
      changed += 1;
      if (after.lifecycle === 'dormant' && before.lifecycle !== 'dormant') dormant += 1;
      if (KIND_RANK[after.kind] > KIND_RANK[before.kind]) promoted += 1;
    }
  }

  return { reviewed: memories.length, changed, dormant, promoted };
}
