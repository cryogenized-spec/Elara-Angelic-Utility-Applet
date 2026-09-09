import { classifyDueOccurrence } from '../../../src/autonomy/scheduler';
import { routineRunKey } from '../../../src/autonomy/contracts';
import { AutonomyEngine } from './engine';

/**
 * Bound only by vitest (see vitest.workers.config.ts). Production wrangler.toml
 * binds AutonomyEngine, which does not expose these mutators as RPC.
 */
export class TestAutonomyEngine extends AutonomyEngine {
  async claimWithoutDispatch(routineId: string, dueAt: number): Promise<{ runKey: string; workflowInstanceId: string; dispatched: boolean }> {
    const now = Date.now();
    const generation = this.stateGeneration();
    const routine = this.store.getRoutine(routineId);
    if (!routine || !Number.isFinite(dueAt)) throw new Error('claimWithoutDispatch needs routineId and dueAt.');
    const classification = classifyDueOccurrence(routine.schedule, routine.timezone, dueAt, now);
    const executionMode = classification.mode === 'catch-up' ? 'catch-up' : 'scheduled';
    const runKey = routineRunKey(routine.id, executionMode, dueAt);
    const runId = `run-${crypto.randomUUID()}`;
    const envelope = await this.freezeEnvelope({ routine, runKey, runId, executionMode, occurrence: dueAt, now, generation });
    this.store.claimCloudRun({
      id: runId, runKey, routineId: routine.id, routineName: routine.name, executionMode,
      scheduledFor: dueAt, startedAt: now, state: 'running',
    }, envelope, generation);
    this.store.upsertSchedule(routine.id, dueAt, now);
    this.journal(now, 'claimed', { generation, routineId: routine.id, occurrence: dueAt, detail: envelope.workflowInstanceId });
    return { runKey, workflowInstanceId: envelope.workflowInstanceId, dispatched: false };
  }

  async markDispatchedWithoutAdvance(runKey: string): Promise<{ runKey: string; dispatched: boolean; scheduleAdvanced: boolean }> {
    const row = this.store.getEnvelope(runKey);
    if (!row) throw new Error('claim-not-found');
    this.store.markEnvelopeDispatched(runKey);
    return { runKey, dispatched: true, scheduleAdvanced: false };
  }

  async ageRun(runKey: string, startedAt: number): Promise<{ runKey: string; startedAt: number }> {
    this.store.setRunStartedAt(runKey, startedAt);
    return { runKey, startedAt };
  }

  async pruneNow(): Promise<{ pruned: true; envelopeCount: number }> {
    this.store.pruneRuns(Date.now());
    return { pruned: true, envelopeCount: this.store.listEnvelopeRunKeys().length };
  }

  async envelopePresent(runKey: string): Promise<boolean> {
    return Boolean(this.store.getEnvelope(runKey));
  }
}
