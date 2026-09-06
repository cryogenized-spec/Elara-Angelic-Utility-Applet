import type { DurableMemory } from './types';
import { memory } from './capability';
import { getMemory, reinforceMemory, updateMemory } from './store';

export type ObservationRelation = 'support' | 'conflict' | 'related';

export interface ObservationRequest {
  title: string;
  body: string;
  tags?: string[];
}

export interface ObservationContext {
  conversationId?: string;
  messageId?: string;
  folderId?: string | null;
  provenanceNote?: string;
}

function appendUnique(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** Record a fresh piece of evidence without promoting it into an established memory. */
export async function recordObservation(request: ObservationRequest, context: ObservationContext = {}): Promise<DurableMemory> {
  return memory.save(
    { title: request.title, body: request.body, kind: 'MICRO_OBSERVATION', tags: request.tags },
    context,
  );
}

/**
 * Explicitly attach an observation to an established memory.
 * Supporting evidence reinforces the target; conflicting evidence is retained
 * as a visible relationship and never overwrites the target prose.
 */
export async function consolidateObservation(
  observationId: string,
  targetMemoryId: string,
  relation: ObservationRelation,
): Promise<DurableMemory> {
  if (observationId === targetMemoryId) throw new Error('An observation cannot consolidate against itself.');

  const observation = await getMemory(observationId);
  if (!observation) throw new Error('Observation not found.');
  if (observation.kind !== 'MICRO_OBSERVATION') throw new Error('Only micro-observations can be consolidated.');

  const target = await getMemory(targetMemoryId);
  if (!target) throw new Error('Target memory not found.');

  if (relation === 'support') {
    const reinforced = await reinforceMemory(target.id);
    return updateMemory(reinforced.id, {
      supportingMemoryIds: appendUnique(reinforced.supportingMemoryIds, observation.id),
    });
  }

  if (relation === 'conflict') {
    return updateMemory(target.id, {
      conflictingMemoryIds: appendUnique(target.conflictingMemoryIds, observation.id),
    });
  }

  return updateMemory(target.id, {
    relatedMemoryIds: appendUnique(target.relatedMemoryIds, observation.id),
  });
}
