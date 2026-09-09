import { z } from 'zod';
import { autonomyContextRecordSchema } from './context';
import { elaraRoutineSchema, ROUTINE_EXECUTION_MODES } from './contracts';

// ---------------------------------------------------------------------------
// RoutineRunEnvelope — the immutable execution payload frozen at claim time.
//
// The Workflow must not reread the live routine mirror. Instruction, permissions,
// policy, and Autonomy Context at claim are the only inputs C2 may reason over.
// Live disable/delete/master-off still gate *admission* at completion (C0).
// configGeneration/stateGeneration are snapshots. Mid-run checks are C2.
// ---------------------------------------------------------------------------

export const C0_SHELL_CODE = 'C0_SHELL';
export const ROUTINE_RUN_ENVELOPE_VERSION = 1 as const;

export const routineRunEnvelopeSchema = z.strictObject({
  version: z.literal(ROUTINE_RUN_ENVELOPE_VERSION),
  runKey: z.string().min(1),
  runId: z.string().min(1),
  workflowInstanceId: z.string().min(1).max(100),
  routineId: z.string().min(1),
  executionMode: z.enum(ROUTINE_EXECUTION_MODES),
  scheduledFor: z.number().finite(),
  claimedAt: z.number().finite(),
  configGeneration: z.number().int().min(0),
  stateGeneration: z.number().int().min(0),
  routine: elaraRoutineSchema,
  context: z.strictObject({
    contentHash: z.string().length(64),
    syncedAt: z.number().finite(),
    records: z.array(autonomyContextRecordSchema),
  }).nullable(),
});
export type RoutineRunEnvelope = z.infer<typeof routineRunEnvelopeSchema>;

export const runCompleteRequestSchema = z.strictObject({
  runKey: z.string().min(1),
  workflowInstanceId: z.string().min(1).max(100),
});
export type RunCompleteRequest = z.infer<typeof runCompleteRequestSchema>;

/** Explicit completion outcomes. The Workflow retries only `retryable-error`. */
export const RUN_COMPLETE_STATUSES = [
  'completed',
  'already-completed',
  'cancelled',
  'claim-not-found',
  'identity-mismatch',
  'missing-envelope',
  'retryable-error',
] as const;
export type RunCompleteStatus = (typeof RUN_COMPLETE_STATUSES)[number];
