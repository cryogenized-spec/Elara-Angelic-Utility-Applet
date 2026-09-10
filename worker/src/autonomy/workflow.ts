import { WorkflowEntrypoint } from 'cloudflare:workers';
import { ELARA_INTERNAL_HEADER, deriveInstallationId, internalWakeMarker } from '../../../src/autonomy/protocol';
import { routineRunEnvelopeSchema, type RoutineRunEnvelope, type RunCompleteStatus } from '../../../src/autonomy/envelope';
import { cloudAdmitResultSchema, type CloudAdmitResult } from '../../../src/autonomy/cloud-result';
import { CloudExecuteRetryError, executeCloudRoutine } from './cloud-execute';
import type { Env } from '../index';

// ---------------------------------------------------------------------------
// RoutineRunWorkflow — Phase C1 execution plane.
//
// step execute: bounded Gemini call against the frozen envelope (retryable
// only for transient provider failures).
// step admit: Durable Object is the sole admission/persistence boundary.
// create()/get() prove instance identity/existence, not liveness.
// ---------------------------------------------------------------------------

export class RoutineRunWorkflow extends WorkflowEntrypoint<Env, RoutineRunEnvelope> {
  async run(event: WorkflowEvent<RoutineRunEnvelope>, step: WorkflowStep): Promise<{ runKey: string; status: RunCompleteStatus }> {
    const envelope = routineRunEnvelopeSchema.parse(event.payload);
    const executed = await step.do('execute', async () => {
      try {
        return await executeCloudRoutine(envelope, this.env);
      } catch (error) {
        if (error instanceof CloudExecuteRetryError) throw error;
        throw error;
      }
    });
    const result = cloudAdmitResultSchema.parse(executed);
    return step.do('admit', async () => this.admit(envelope, result));
  }

  private async admit(envelope: RoutineRunEnvelope, result: CloudAdmitResult): Promise<{ runKey: string; status: RunCompleteStatus }> {
    const token = this.env.ELARA_INSTALLATION_TOKEN;
    if (!token || !this.env.AUTONOMY) throw new Error('Autonomy is not configured on this worker.');
    const installationId = await deriveInstallationId(token);
    const stub = this.env.AUTONOMY.get(this.env.AUTONOMY.idFromName(installationId));
    const response = await stub.fetch('https://autonomy-engine/run/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ELARA_INTERNAL_HEADER]: await internalWakeMarker(token),
      },
      body: JSON.stringify({ runKey: envelope.runKey, workflowInstanceId: envelope.workflowInstanceId, result }),
    });
    const body = await response.json().catch(() => null) as { status?: RunCompleteStatus } | null;
    const status = body?.status;
    if (response.status >= 500 || status === 'retryable-error') {
      throw new Error(`Run admission is retryable (HTTP ${response.status}).`);
    }
    if (status) return { runKey: envelope.runKey, status };
    throw new Error(`Run admission failed (HTTP ${response.status}).`);
  }
}
