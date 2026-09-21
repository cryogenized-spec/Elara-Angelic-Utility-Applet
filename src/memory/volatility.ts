import type { DurableMemory } from './types';

/**
 * Provenance and volatility normalization (Pass 4 groundwork).
 *
 * These are *derived views* over existing canonical fields (source, tags,
 * kind, confidence, reinforcement) — no schema change, no new model-supplied
 * data, fully deterministic. They exist so that synthesis and retrieval can
 * distinguish grounded stable claims from transient operational inference
 * without fossilizing the latter as permanent dogma.
 */

export const PROVENANCE_CLASSES = [
  'explicit-user',
  'user-behavior',
  'trusted-app-event',
  'external-observation',
  'external-inference',
] as const;
export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export const VOLATILITY_LEVELS = ['stable', 'medium', 'high', 'very-high'] as const;
export type VolatilityLevel = (typeof VOLATILITY_LEVELS)[number];

export interface MemoryVolatilityProfile {
  provenanceClass: ProvenanceClass;
  volatility: VolatilityLevel;
  requiresRevalidation: boolean;
}

const VOLATILITY_RANK: Readonly<Record<VolatilityLevel, number>> = {
  stable: 0,
  medium: 1,
  high: 2,
  'very-high': 3,
};

/**
 * Narrow deterministic hints for operational/stateful claims whose truth
 * decays quickly: PR/CI/branch state, availability, "currently" phrasing.
 * Like the sensitive-category hint layer, this is deliberately narrow — it
 * marks volatility, it never blocks persistence.
 */
export function hasOperationalStateHint(value: string): boolean {
  return /\b(?:pr\s*#\s*\d+|pull request\s*#\s*\d+|ci\s+(?:is|was|currently|has been)\w*|build\s+(?:is|was|currently|has been)\w*|tests?\s+(?:is|was|currently|are|were)\s+(?:failing|red|green|broken|passing)|unmerged|merge state|branch\s+(?:contains|has|is)|\d+\s+(?:tests|jobs)\s+(?:failing|red)|currently\s+(?:unavailable|failing|broken|red|green|available)|tool\s+(?:is|was)\s+(?:unavailable|available)|unavailable today)\b/i.test(value);
}

/**
 * Normalize the provenance class of a canonical record from its existing
 * authority fields. `elara`-sourced records are model-initiated writes that
 * only commit through user confirmation, so they are user-directed;
 * `trusted-app-event` and `external-inference` are reserved for future
 * application events and remain conservatively volatile.
 */
export function deriveProvenanceClass(memory: DurableMemory): ProvenanceClass {
  if (memory.tags.includes('organic')) return 'user-behavior';
  if (memory.source.source === 'import') return 'external-observation';
  if (memory.source.source === 'migration') return 'external-observation';
  if (memory.source.source === 'user') return 'explicit-user';
  return 'explicit-user';
}

function escalate(current: VolatilityLevel, minimum: VolatilityLevel): VolatilityLevel {
  return VOLATILITY_RANK[current] >= VOLATILITY_RANK[minimum] ? current : minimum;
}

/**
 * Derive the volatility profile for one canonical record.
 *
 * - explicit user direction is stable;
 * - un-reinforced organic micro-evidence is high volatility and requires
 *   revalidation before being presented as current;
 * - operational-state claims are at least high volatility regardless of
 *   provenance, and external inference is the most volatile class;
 * - CORE is not automatically granted by repetition: nothing here promotes
 *   kind or confidence.
 */
export function deriveMemoryVolatility(memory: DurableMemory): MemoryVolatilityProfile {
  const provenanceClass = deriveProvenanceClass(memory);
  const operational = hasOperationalStateHint(`${memory.title}\n${memory.body}`);

  let volatility: VolatilityLevel;
  switch (provenanceClass) {
    case 'explicit-user':
      volatility = 'stable';
      break;
    case 'trusted-app-event':
      volatility = 'medium';
      break;
    case 'external-observation':
      volatility = 'medium';
      break;
    case 'external-inference':
      volatility = 'very-high';
      break;
    case 'user-behavior':
      if (memory.kind === 'MICRO_OBSERVATION') {
        volatility = memory.reinforcementCount >= 1 ? 'medium' : 'high';
      } else if (memory.kind === 'EPISODIC') {
        volatility = 'medium';
      } else {
        volatility = memory.confidence >= 0.8 ? 'medium' : 'high';
      }
      break;
  }

  if (operational) volatility = escalate(volatility, 'high');
  const requiresRevalidation = volatility === 'high' || volatility === 'very-high' || operational;

  return { provenanceClass, volatility, requiresRevalidation };
}
