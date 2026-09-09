import { z } from 'zod';
import { routineOutcomeSchema } from './outcome';

// ---------------------------------------------------------------------------
// Cloud admit payload — what the Workflow sends the DO after model execution.
//
// disposition is the Workflow's classification. The DO still re-checks live
// authority and event budget before any AutonomousEvent is written.
// No chain-of-thought / hidden reasoning is accepted.
// ---------------------------------------------------------------------------

export const cloudAdmitResultSchema = z.discriminatedUnion('disposition', [
  z.strictObject({
    disposition: z.literal('noop'),
    reason: z.string().max(500).optional(),
    itemsExamined: z.number().int().min(0).max(100_000).optional(),
  }),
  z.strictObject({
    disposition: z.literal('cannot_act'),
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({
    disposition: z.literal('event'),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(4_000),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    itemsExamined: z.number().int().min(0).max(100_000).optional(),
    evidence: z.array(z.strictObject({
      kind: z.literal('memory'),
      ref: z.string().min(1).max(300),
      note: z.string().max(300).optional(),
    })).max(8).optional(),
  }),
  z.strictObject({
    disposition: z.literal('error'),
    source: z.literal('execution'),
    errorCode: z.string().min(1).max(64),
    errorMessage: z.string().min(1).max(500),
  }),
]);
export type CloudAdmitResult = z.infer<typeof cloudAdmitResultSchema>;

export function cloudAdmitFromOutcome(outcome: z.infer<typeof routineOutcomeSchema>): CloudAdmitResult {
  if (outcome.outcome === 'noop') {
    return { disposition: 'noop', reason: outcome.reason, itemsExamined: outcome.itemsExamined };
  }
  if (outcome.outcome === 'cannot_act') {
    return { disposition: 'cannot_act', reason: outcome.reason };
  }
  const evidence = outcome.evidence ?? [];
  if (evidence.some((item) => item.kind !== 'memory')) {
    return {
      disposition: 'error',
      source: 'execution',
      errorCode: 'OUTCOME_INVALID_CONTRACT',
      errorMessage: 'C1 cloud events may only cite memory evidence; tool and web evidence are not available.',
    };
  }
  return {
    disposition: 'event',
    title: outcome.title,
    summary: outcome.summary,
    importance: outcome.importance,
    confidence: outcome.confidence,
    itemsExamined: outcome.itemsExamined,
    evidence: evidence.map((item) => ({ kind: 'memory' as const, ref: item.ref, note: item.note })),
  };
}
