import { classifyDueOccurrence } from '../../../src/autonomy/scheduler';
import { routineRunKey } from '../../../src/autonomy/contracts';
import { AutonomyEngine } from './engine';

/**
 * Bound only by vitest (see vitest.workers.config.ts). Production wrangler.toml
 * binds AutonomyEngine, which does not expose these mutators as RPC.
 */
export class TestAutonomyEngine extends AutonomyEngine {
  private dispatchHold: Promise<void> | null = null;
  private releaseDispatchHold: (() => void) | null = null;
  private dispatchEntered: Promise<void> | null = null;
  private markDispatchEntered: (() => void) | null = null;

  async holdNextDispatch(): Promise<void> {
    this.dispatchEntered = new Promise((resolve) => {
      this.markDispatchEntered = resolve;
    });
    this.dispatchHold = new Promise((resolve) => {
      this.releaseDispatchHold = resolve;
    });
  }

  async waitUntilDispatchHeld(): Promise<void> {
    if (this.dispatchEntered) await this.dispatchEntered;
  }

  async releaseHeldDispatch(): Promise<void> {
    this.releaseDispatchHold?.();
    this.dispatchHold = null;
    this.releaseDispatchHold = null;
  }

  protected override async beforeWorkflowDispatch(): Promise<void> {
    this.markDispatchEntered?.();
    if (this.dispatchHold) await this.dispatchHold;
  }

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
    }, envelope, envelope.configGeneration);
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

  /** C2 tests: bump configGeneration without recoverInFlight / Workflow dispatch. */
  async setConfigGeneration(generation: number): Promise<{ generation: number }> {
    this.store.setMeta('configGeneration', String(generation));
    return { generation };
  }

  /** C2 tests: live gates without bumping configGeneration. */
  async setMasterEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    this.store.setMeta('autonomyEnabled', String(enabled));
    return { enabled };
  }

  async disableRoutine(routineId: string): Promise<{ disabled: boolean }> {
    const routine = this.store.getRoutine(routineId);
    if (!routine) return { disabled: false };
    this.store.putRoutine({ ...routine, enabled: false, updatedAt: Date.now() });
    return { disabled: true };
  }

  async deleteRoutineMirror(routineId: string): Promise<{ deleted: boolean }> {
    this.store.deleteRoutine(routineId);
    return { deleted: true };
  }
}
