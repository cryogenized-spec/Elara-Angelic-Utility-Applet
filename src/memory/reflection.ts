import type { DurableMemory } from './types';

/**
 * Future reflection extension contract (established, not yet scheduled).
 *
 * A later reflection job — daily/nightly/scheduled — will consume this input,
 * reason about recurrence, staleness, conflicts, and emerging patterns, and
 * propose observations/consolidations through the SAME canonical capability
 * boundary as interactive chat. This module is deliberately pure: it must
 * never import IndexedDB, Dexie, providers, or schedulers, so reflection
 * logic stays decoupled from persistence and today's chat path gains no
 * autonomous mutation powers.
 *
 * ```text
 * Recent conversations + Durable memories + Observations
 *                    │
 *                    ▼
 *             Reflection job
 *                    │
 *        ┌──────────┼──────────┐
 *        ▼          ▼          ▼
 *     patterns  conflicts  recurrence
 *        │          │          │
 *        └──────────┼──────────┘
 *                   ▼
 *   observations / consolidation /
 *        future memory decisions
 * ```
 */

export interface ReflectionConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  conversationId: string;
  messageId: string;
}

export interface ReflectionInput {
  readonly recentConversationSlice: readonly ReflectionConversationMessage[];
  readonly relevantMemories: readonly DurableMemory[];
  readonly relevantObservations: readonly DurableMemory[];
  readonly now: number;
}

export const REFLECTION_BOUNDS = {
  maxSliceMessages: 40,
  maxSliceCharacters: 12_000,
  maxMemories: 20,
  maxObservations: 40,
} as const;

export interface AssembleReflectionInput {
  recentConversationSlice: readonly ReflectionConversationMessage[];
  relevantMemories: readonly DurableMemory[];
  relevantObservations: readonly DurableMemory[];
  now: number;
}

/**
 * Pure, bounded assembly of one reflection job's input. Newest slice
 * messages win when the slice must be truncated; ordering is chronological
 * so a future reasoner sees cause before effect.
 */
export function assembleReflectionInput(input: AssembleReflectionInput): ReflectionInput {
  if (!Number.isFinite(input.now)) throw new Error('Reflection input requires a finite timestamp.');
  const slice = [...input.recentConversationSlice]
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.text.trim())
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-REFLECTION_BOUNDS.maxSliceMessages);
  let characters = 0;
  const boundedSlice: ReflectionConversationMessage[] = [];
  for (const message of [...slice].reverse()) {
    if (boundedSlice.length > 0 && characters + message.text.length > REFLECTION_BOUNDS.maxSliceCharacters) break;
    boundedSlice.unshift(message);
    characters += message.text.length;
  }
  return {
    recentConversationSlice: boundedSlice,
    relevantMemories: [...input.relevantMemories].slice(0, REFLECTION_BOUNDS.maxMemories),
    relevantObservations: [...input.relevantObservations].slice(0, REFLECTION_BOUNDS.maxObservations),
    now: input.now,
  };
}
