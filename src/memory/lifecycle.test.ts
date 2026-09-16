import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { memory } from './capability';
import { recordObservation } from './observation';
import {
  applyMemoryLifecyclePolicy,
  findExactEvidenceSupportTarget,
  ORGANIC_EPISODIC_DORMANCY_MS,
  ORGANIC_MICRO_DORMANCY_MS,
  reinforceMemoryFromEvidence,
  sweepMemoryLifecycle,
} from './lifecycle';
import { getMemory, updateMemory } from './store';

describe('memory lifecycle policy', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('matches automatic support only for same-scope, same-domain, text-equivalent evidence', async () => {
    const target = await recordObservation(
      { title: 'Observed preference', body: 'I prefer compact layouts', tags: ['organic', 'domain:preference'] },
      { folderId: 'folder-a' },
    );
    const equivalent = await recordObservation(
      { title: 'Observed preference', body: '  I PREFER   compact layouts  ', tags: ['organic', 'domain:preference'] },
      { folderId: 'folder-a' },
    );
    const otherScope = await recordObservation(
      { title: 'Observed preference', body: 'I prefer compact layouts', tags: ['organic', 'domain:preference'] },
      { folderId: 'folder-b' },
    );
    const otherDomain = await recordObservation(
      { title: 'Observed context', body: 'I prefer compact layouts', tags: ['organic', 'domain:recurring_context'] },
      { folderId: 'folder-a' },
    );

    expect((await findExactEvidenceSupportTarget(equivalent))?.id).toBe(target.id);
    expect(await findExactEvidenceSupportTarget(otherScope)).toBeUndefined();
    expect(await findExactEvidenceSupportTarget(otherDomain)).toBeUndefined();
  });

  it('raises epistemic weight in bounded steps without reviving superseded memories', async () => {
    const target = await memory.save({ title: 'Preference', body: 'The user prefers compact layouts.', confidence: 0.6, importance: 0.35 });
    const reinforced = await reinforceMemoryFromEvidence(target.id);
    expect(reinforced).toMatchObject({ reinforcementCount: 1, confidence: 0.68, importance: 0.39, lifecycle: 'active' });

    await updateMemory(target.id, { supersededBy: ['replacement'], lifecycle: 'dormant' });
    const historical = await reinforceMemoryFromEvidence(target.id);
    expect(historical.reinforcementCount).toBe(2);
    expect(historical.lifecycle).toBe('dormant');
  });

  it('promotes supported evidence one stage at a time and never auto-promotes to CORE', async () => {
    const memoryRecord = await recordObservation({
      title: 'Observed preference',
      body: 'I prefer compact layouts',
      tags: ['organic', 'domain:preference'],
      confidence: 0.84,
      importance: 0.5,
    });
    await updateMemory(memoryRecord.id, {
      reinforcementCount: 3,
      supportingMemoryIds: ['support-1', 'support-2', 'support-3'],
    });

    const episodic = await applyMemoryLifecyclePolicy(memoryRecord.id);
    expect(episodic.kind).toBe('EPISODIC');
    const contextual = await applyMemoryLifecyclePolicy(memoryRecord.id);
    expect(contextual.kind).toBe('CONTEXTUAL');
    const stillContextual = await applyMemoryLifecyclePolicy(memoryRecord.id);
    expect(stillContextual.kind).toBe('CONTEXTUAL');
  });

  it('blocks automatic promotion while unresolved contradictory evidence exists', async () => {
    const memoryRecord = await recordObservation({
      title: 'Observed preference',
      body: 'I prefer compact layouts',
      tags: ['organic', 'domain:preference'],
      confidence: 0.9,
    });
    await updateMemory(memoryRecord.id, {
      reinforcementCount: 5,
      supportingMemoryIds: ['s1', 's2', 's3', 's4', 's5'],
      conflictingMemoryIds: ['c1'],
    });

    const result = await applyMemoryLifecyclePolicy(memoryRecord.id);
    expect(result.kind).toBe('MICRO_OBSERVATION');
  });

  it('makes superseded and expired records dormant without deleting them', async () => {
    const superseded = await memory.save({ title: 'Old fact', body: 'Old state.' });
    await updateMemory(superseded.id, { supersededBy: ['replacement'] });
    const dormantSuperseded = await applyMemoryLifecyclePolicy(superseded.id);
    expect(dormantSuperseded.lifecycle).toBe('dormant');
    expect(await getMemory(superseded.id)).toBeDefined();

    const expired = await memory.save({ title: 'Temporary fact', body: 'Temporary state.', expiresAt: 1_000 });
    const dormantExpired = await applyMemoryLifecyclePolicy(expired.id, 2_000);
    expect(dormantExpired.lifecycle).toBe('dormant');
  });

  it('dormants only stale weak organic evidence, leaving deliberate memory alone', async () => {
    const now = Date.now();
    const organicMicro = await recordObservation({
      title: 'Observed context', body: 'Temporary recurring context', tags: ['organic', 'domain:recurring_context'],
    });
    const deliberate = await memory.save({ title: 'Deliberate context', body: 'Keep this.', kind: 'CONTEXTUAL' });

    const dormant = await applyMemoryLifecyclePolicy(organicMicro.id, now + ORGANIC_MICRO_DORMANCY_MS + 1);
    const retained = await applyMemoryLifecyclePolicy(deliberate.id, now + ORGANIC_EPISODIC_DORMANCY_MS + 1);
    expect(dormant.lifecycle).toBe('dormant');
    expect(retained.lifecycle).toBe('active');
  });

  it('offers an explicit maintenance sweep without creating a scheduled lifecycle owner', async () => {
    const now = Date.now();
    await recordObservation({ title: 'Observed context', body: 'Weak organic note', tags: ['organic', 'domain:recurring_context'] });
    await memory.save({ title: 'Deliberate memory', body: 'Keep me.', kind: 'CONTEXTUAL' });

    const result = await sweepMemoryLifecycle(now + ORGANIC_MICRO_DORMANCY_MS + 1);
    expect(result).toEqual({ reviewed: 2, changed: 1, dormant: 1, promoted: 0 });
  });
});
