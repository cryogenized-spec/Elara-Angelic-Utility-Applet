import type { DurableMemory } from './types';
import { memory, type MemoryCapabilityContext } from './capability';
import { getMemory, reinforceMemory, updateMemory } from './store';
import { authorizeMemoryMutation } from './permissions';

export type ObservationRelation = 'support' | 'conflict' | 'related';

export interface ObservationRequest {
  title: string;
  body: string;
  tags?: string[];
}

export type ObservationContext = MemoryCapabilityContext;

export interface SupersessionResult {
  target: DurableMemory;
  replacement: DurableMemory;
}

function appendUnique(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

function existingObservationRelation(target: DurableMemory, observationId: string): ObservationRelation | undefined {
  if (target.supportingMemoryIds.includes(observationId)) return 'support';
  if (target.conflictingMemoryIds.includes(observationId)) return 'conflict';
  if (target.relatedMemoryIds.includes(observationId)) return 'related';
  return undefined;
}

/** Record a fresh piece of evidence without promoting it into an established memory. */
export async function recordObservation(request: ObservationRequest, context: ObservationContext = {}): Promise<DurableMemory> {
  authorizeMemoryMutation('observe', context);
  return memory.save(
    { title: request.title, body: request.body, kind: 'MICRO_OBSERVATION', tags: request.tags },
    context,
  );
}

/**
 * Explicitly attach an observation to an established memory.
 * Supporting evidence reinforces the target once; conflicting evidence is
 * retained as a visible relationship and never overwrites the target prose.
 * Replaying the same observation/relation is a no-op rather than a second
 * reinforcement, while attempting to reclassify that observation fails closed.
 */
export async function consolidateObservation(
  observationId: string,
  targetMemoryId: string,
  relation: ObservationRelation,
  context: ObservationContext = {},
): Promise<DurableMemory> {
  authorizeMemoryMutation('consolidate', context);

  if (observationId === targetMemoryId) throw new Error('An observation cannot consolidate against itself.');

  const observation = await getMemory(observationId);
  if (!observation) throw new Error('Observation not found.');
  if (observation.kind !== 'MICRO_OBSERVATION') throw new Error('Only micro-observations can be consolidated.');

  const target = await getMemory(targetMemoryId);
  if (!target) throw new Error('Target memory not found.');

  const existingRelation = existingObservationRelation(target, observation.id);
  if (existingRelation === relation) return target;
  if (existingRelation) throw new Error('Observation is already consolidated with a different relation.');

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

/**
 * Create a conservative replacement and link both sides of the supersession.
 * The old memory remains active until the lifecycle pass decides otherwise.
 * CORE authority is never inherited automatically; episodic targets remain
 * episodic, everything else restarts as contextual evidence.
 */
export async function supersedeMemory(
  targetMemoryId: string,
  request: ObservationRequest,
  context: ObservationContext = {},
): Promise<SupersessionResult> {
  authorizeMemoryMutation('consolidate', context);
  const target = await getMemory(targetMemoryId);
  if (!target) throw new Error('Target memory not found.');
  if (target.kind === 'MICRO_OBSERVATION') throw new Error('Micro-observations cannot be superseded through reconciliation.');

  let replacement = await memory.save(
    {
      title: request.title,
      body: request.body,
      kind: target.kind === 'EPISODIC' ? 'EPISODIC' : 'CONTEXTUAL',
      tags: request.tags,
    },
    context,
  );

  if (!replacement.supersedes.includes(target.id)) {
    replacement = await updateMemory(replacement.id, {
      supersedes: appendUnique(replacement.supersedes, target.id),
    });
  }

  let linkedTarget = (await getMemory(target.id)) ?? target;
  if (!linkedTarget.supersededBy.includes(replacement.id)) {
    linkedTarget = await updateMemory(linkedTarget.id, {
      supersededBy: appendUnique(linkedTarget.supersededBy, replacement.id),
    });
  }

  return { target: linkedTarget, replacement };
}
