import { WorkflowEntrypoint } from 'cloudflare:workers';
import { ELARA_INTERNAL_HEADER, deriveInstallationId, internalWakeMarker } from '../../../src/autonomy/protocol';
import { routineRunEnvelopeSchema, type RoutineRunEnvelope, type RunCompleteStatus } from '../../../src/autonomy/envelope';
import type { Env } from '../index';

// ---------------------------------------------------------------------------
// RoutineRunWorkflow — Phase C0 execution plane.
//
// One instance per hashed runKey. C0 does not call Gemini: a single durable
// step asks the Durable Object to complete the claim. The DO returns an
// explicit status. Only `retryable-error` (HTTP 5xx) retries the step.
// claim-not-found is a terminal failure, never "already completed".
// ---------------------------------------------------------------------------

export class RoutineRunWorkflow extends WorkflowEntrypoint<Env, RoutineRunEnvelope> {
  async run(event: WorkflowEvent<RoutineRunEnvelope>, step: WorkflowStep): Promise<{ runKey: string; status: RunCompleteStatus }> {
    const envelope = routineRunEnvelopeSchema.parse(event.payload);
    return step.do('complete-claim', async () => {
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
        body: JSON.stringify({ runKey: envelope.runKey, workflowInstanceId: envelope.workflowInstanceId }),
      });
      const body = await response.json().catch(() => null) as { status?: RunCompleteStatus } | null;
      const status = body?.status;
      if (response.status >= 500 || status === 'retryable-error') {
        throw new Error(`Run completion is retryable (HTTP ${response.status}).`);
      }
      if (status) return { runKey: envelope.runKey, status };
      throw new Error(`Run completion failed (HTTP ${response.status}).`);
    });
  }
}
