import { WorkflowEntrypoint } from 'cloudflare:workers';
import { ELARA_INTERNAL_HEADER, deriveInstallationId, internalWakeMarker } from '../../../src/autonomy/protocol';
import { routineRunEnvelopeSchema, type RoutineRunEnvelope } from '../../../src/autonomy/envelope';
import type { Env } from '../index';

// ---------------------------------------------------------------------------
// RoutineRunWorkflow — Phase C0 execution plane.
//
// One instance per hashed runKey. C0 does not call Gemini: a single durable
// step asks the Durable Object to complete the claim idempotently (stub
// no-op, or cancelled-admission if the live gate forbids it). Step retries
// cover "Workflow finished → DO persist failed".
// ---------------------------------------------------------------------------

export class RoutineRunWorkflow extends WorkflowEntrypoint<Env, RoutineRunEnvelope> {
  async run(event: WorkflowEvent<RoutineRunEnvelope>, step: WorkflowStep): Promise<{ runKey: string; alreadyCompleted: boolean }> {
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
      if (response.status === 404) return { runKey: envelope.runKey, alreadyCompleted: true };
      if (!response.ok && response.status < 500) throw new Error(`Run completion was rejected (HTTP ${response.status}).`);
      if (!response.ok) throw new Error(`Run completion was not acknowledged (HTTP ${response.status}).`);
      const body = await response.json() as { alreadyCompleted?: boolean };
      return { runKey: envelope.runKey, alreadyCompleted: body.alreadyCompleted === true };
    });
  }
}
