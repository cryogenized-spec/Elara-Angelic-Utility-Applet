import type { DurableMemory } from './types';
import { memory, type MemoryCapabilityContext } from './capability';
import { getMemory, updateMemory } from './store';
import { authorizeMemoryMutation } from './permissions';
import { applyMemoryLifecyclePolicy, reinforceMemoryFromEvidence } from './lifecycle';
import { MEMORY_MAX_RELATIONSHIPS } from './normalize';

export type ObservationRelation = 'support' | 'conflict' | 'related';

export interface ObservationRequest {
  title: string;
  body: string;
  tags?: string[];
  /** Application-owned epistemic weight; model-facing reconcile omits these. */
  confidence?: number;
  importance?: number;
}

export type ObservationContext = MemoryCapabilityContext;

export interface SupersessionResult {
  target: DurableMemory;
  replacement: DurableMemory;
}

function appendUnique(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

function assertRelationshipCapacity(ids: readonly string[], id: string, relation: string): void {
  if (!ids.includes(id) && ids.length >= MEMORY_MAX_RELATIONSHIPS) {
    throw new Error(`Memory ${relation} relationship capacity reached.`);
  }
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
    {
      title: request.title,
      body: request.body,
      kind: 'MICRO_OBSERVATION',
      tags: request.tags,
      confidence: request.confidence,
      importance: request.importance,
    },
    context,
  );
}

/**
 * Explicitly attach an observation to an established memory.
 * Supporting evidence reinforces the target once using the application-owned
 * lifecycle policy; conflicting evidence is retained without rewriting prose.
 * Replaying the same relation is a no-op and reclassification fails closed.
 * Relationship capacity is checked before any mutation so normalization can
 * never silently drop a link after epistemic weight has changed.
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
    assertRelationshipCapacity(target.supportingMemoryIds, observation.id, 'supporting');
    const reinforced = await reinforceMemoryFromEvidence(target.id);
    const linked = await updateMemory(reinforced.id, {
      supportingMemoryIds: appendUnique(reinforced.supportingMemoryIds, observation.id),
    });
    // Supporting evidence is retained but recedes behind the consolidated target.
    if (observation.lifecycle === 'active') await updateMemory(observation.id, { lifecycle: 'dormant' });
    return applyMemoryLifecyclePolicy(linked.id);
  }

  if (relation === 'conflict') {
    assertRelationshipCapacity(target.conflictingMemoryIds, observation.id, 'conflicting');
    const linked = await updateMemory(target.id, {
      conflictingMemoryIds: appendUnique(target.conflictingMemoryIds, observation.id),
    });
    // Conflict evidence stays active so unresolved contradiction can still surface.
    return applyMemoryLifecyclePolicy(linked.id);
  }

  assertRelationshipCapacity(target.relatedMemoryIds, observation.id, 'related');
  const linked = await updateMemory(target.id, {
    relatedMemoryIds: appendUnique(target.relatedMemoryIds, observation.id),
  });
  if (observation.lifecycle === 'active') await updateMemory(observation.id, { lifecycle: 'dormant' });
  return linked;
}

/**
 * Create a conservative replacement and link both sides of the supersession.
 * CORE authority is never inherited automatically; episodic targets remain
 * episodic, everything else restarts as contextual evidence. Once both links
 * exist, the replaced record becomes dormant rather than being deleted.
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
  if (target.supersededBy.length >= MEMORY_MAX_RELATIONSHIPS) {
    throw new Error('Memory supersession relationship capacity reached.');
  }

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
    assertRelationshipCapacity(replacement.supersedes, target.id, 'supersedes');
    replacement = await updateMemory(replacement.id, {
      supersedes: appendUnique(replacement.supersedes, target.id),
    });
  }

  let linkedTarget = (await getMemory(target.id)) ?? target;
  if (!linkedTarget.supersededBy.includes(replacement.id)) {
    assertRelationshipCapacity(linkedTarget.supersededBy, replacement.id, 'superseded-by');
    linkedTarget = await updateMemory(linkedTarget.id, {
      supersededBy: appendUnique(linkedTarget.supersededBy, replacement.id),
    });
  }

  linkedTarget = await applyMemoryLifecyclePolicy(linkedTarget.id);
  return { target: linkedTarget, replacement };
}
