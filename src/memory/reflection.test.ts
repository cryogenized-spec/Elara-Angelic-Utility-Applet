import { describe, expect, it } from 'vitest';
import { assembleReflectionInput, REFLECTION_BOUNDS, type ReflectionConversationMessage } from './reflection';
import type { DurableMemory } from './types';

function message(partial: Partial<ReflectionConversationMessage> & { messageId: string }): ReflectionConversationMessage {
  return { role: 'user', text: 'hello', createdAt: 1, conversationId: 'thread-1', ...partial };
}

function memory(id: string, kind: DurableMemory['kind'] = 'CONTEXTUAL'): DurableMemory {
  return {
    id,
    kind,
    title: id,
    body: 'body',
    createdAt: 1,
    updatedAt: 1,
    observedAt: 1,
    confidence: 0.7,
    importance: 0.5,
    lifecycle: 'active',
    source: { source: 'elara', createdAt: 1 },
    tags: [],
    relatedMemoryIds: [],
    supportingMemoryIds: [],
    conflictingMemoryIds: [],
    supersedes: [],
    supersededBy: [],
    reinforcementCount: 0,
    folderId: null,
    expiresAt: null,
    lastRecalledAt: null,
    recallCount: 0,
    autonomyContext: false,
  };
}

describe('reflection extension contract', () => {
  it('assembles a bounded, chronological reflection input without persistence coupling', () => {
    const slice = Array.from({ length: REFLECTION_BOUNDS.maxSliceMessages + 10 }, (_, index) =>
      message({ messageId: `msg-${index}`, text: `message ${index}`, createdAt: index, role: index % 2 === 0 ? 'user' : 'assistant' }),
    );
    const input = assembleReflectionInput({
      recentConversationSlice: [...slice].reverse(),
      relevantMemories: Array.from({ length: 30 }, (_, index) => memory(`memory-${index}`)),
      relevantObservations: Array.from({ length: 50 }, (_, index) => memory(`observation-${index}`, 'MICRO_OBSERVATION')),
      now: 1_000,
    });

    expect(input.now).toBe(1_000);
    expect(input.recentConversationSlice).toHaveLength(REFLECTION_BOUNDS.maxSliceMessages);
    // Newest messages win truncation, chronological order is preserved.
    expect(input.recentConversationSlice[0]?.messageId).toBe(`msg-10`);
    expect(input.recentConversationSlice.at(-1)?.messageId).toBe(`msg-${REFLECTION_BOUNDS.maxSliceMessages + 9}`);
    expect(input.relevantMemories).toHaveLength(REFLECTION_BOUNDS.maxMemories);
    expect(input.relevantObservations).toHaveLength(REFLECTION_BOUNDS.maxObservations);
  });

  it('enforces the slice character budget newest-first and drops empty messages', () => {
    const input = assembleReflectionInput({
      recentConversationSlice: [
        message({ messageId: 'old', text: 'x'.repeat(REFLECTION_BOUNDS.maxSliceCharacters), createdAt: 1 }),
        message({ messageId: 'empty', text: '   ', createdAt: 2 }),
        message({ messageId: 'new', text: 'recent and short', createdAt: 3 }),
      ],
      relevantMemories: [],
      relevantObservations: [],
      now: 5,
    });
    expect(input.recentConversationSlice.map((item) => item.messageId)).toEqual(['new']);
  });

  it('requires a finite timestamp', () => {
    expect(() =>
      assembleReflectionInput({ recentConversationSlice: [], relevantMemories: [], relevantObservations: [], now: Number.NaN }),
    ).toThrow('Reflection input requires a finite timestamp.');
  });
});
