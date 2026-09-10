import { describe, expect, it } from 'vitest';
import { CloudExecuteRetryError, executeCloudRoutine, formatFrozenContext } from '../src/autonomy/cloud-execute';
import { makeRoutine } from './helpers';
import type { RoutineRunEnvelope } from '../../src/autonomy/envelope';

function envelope(): RoutineRunEnvelope {
  const routine = makeRoutine({ id: 'routine-c1' });
  return {
    version: 1,
    runKey: 'routine-c1:scheduled:1',
    runId: 'run-c1',
    workflowInstanceId: 'rr' + 'a'.repeat(64),
    routineId: routine.id,
    executionMode: 'scheduled',
    scheduledFor: 1,
    claimedAt: Date.now(),
    configGeneration: 1,
    stateGeneration: 1,
    routine,
    context: null,
  };
}

describe('C1 executeCloudRoutine', () => {
  it('returns GEMINI_UNAVAILABLE when the key is missing', async () => {
    const result = await executeCloudRoutine(envelope(), { C1_MODEL_STUB: 'missing-key' });
    expect(result).toMatchObject({ disposition: 'error', source: 'execution', errorCode: 'GEMINI_UNAVAILABLE' });
  });

  it('returns a contract error for malformed stub output', async () => {
    const result = await executeCloudRoutine(envelope(), { C1_MODEL_STUB: 'malformed' });
    expect(result.disposition).toBe('error');
  });

  it('throws CloudExecuteRetryError when the stub requests retry', async () => {
    await expect(executeCloudRoutine(envelope(), { C1_MODEL_STUB: 'retry' })).rejects.toBeInstanceOf(CloudExecuteRetryError);
  });

  it('maps a valid model JSON stub to an event admit payload', async () => {
    const result = await executeCloudRoutine(envelope(), {
      C1_MODEL_STUB: JSON.stringify({
        disposition: 'event',
        title: 'Inbox note',
        summary: 'Something worth surfacing.',
        importance: 2,
        confidence: 2,
      }),
    });
    expect(result).toMatchObject({ disposition: 'event', title: 'Inbox note' });
  });

  it('projects frozen context record-by-record under the model budget', () => {
    const records = Array.from({ length: 40 }, (_, index) => ({
      id: `mem-${String(index).padStart(3, '0')}`,
      kind: 'CORE' as const,
      title: `Title ${index}`,
      body: 'x'.repeat(400),
      tags: [],
      importance: 1,
      confidence: 1,
      observedAt: 1,
      updatedAt: 1,
    }));
    const packed = envelope();
    packed.routine = { ...packed.routine, permissions: { memory: true, google: [] } };
    packed.context = { contentHash: 'a'.repeat(64), syncedAt: 1, records };
    const first = formatFrozenContext(packed);
    const second = formatFrozenContext(packed);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(12_080);
    expect(first).toContain('mem-000');
    expect(first.split('\n').length).toBeLessThan(records.length);
  });

  it('maps a Gemini JSON outcome through the completeTurn hook', async () => {
    const result = await executeCloudRoutine(envelope(), { GEMINI_API_KEY: 'test-key' }, async () => '{"outcome":"noop","reason":"nothing new"}');
    expect(result).toEqual({ disposition: 'noop', reason: 'nothing new', itemsExamined: undefined });
  });
});
