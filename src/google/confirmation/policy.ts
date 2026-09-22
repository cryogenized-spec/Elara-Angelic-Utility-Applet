import { z } from 'zod';
import type { GoogleToolRisk } from '../tools/contracts';

export const MAX_CONFIRMATION_REVIEW_CHARS = 1_250_000;
export const MAX_CONFIRMATION_ATTACHMENT_PREVIEW_CHARS = 20_000;

export const confirmationAttachmentReviewSchema = z.object({
  name: z.string().min(1).max(500),
  uploadName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  previewText: z.string().min(1).max(MAX_CONFIRMATION_ATTACHMENT_PREVIEW_CHARS).optional(),
  previewTruncated: z.boolean().optional(),
}).strict();

export const writeConfirmationSchema = z.object({
  tool: z.string().min(1),
  risk: z.enum(['write', 'destructive', 'send']),
  resourceSummary: z.string().min(1),
  /** Optional full text that the human must be able to inspect before approving the mutation. */
  reviewText: z.string().min(1).max(MAX_CONFIRMATION_REVIEW_CHARS).optional(),
  /** Human-safe attachment metadata/preview. Exact bytes remain bound by the artifact authority. */
  attachmentReview: confirmationAttachmentReviewSchema.optional(),
  /**
   * True when external provider content was observed before the model proposed
   * this mutation. Such content is evidence, never authority, so the broker
   * must require an explicit human selection rather than preselecting it.
   */
  untrustedContext: z.boolean().optional(),
  requestedAt: z.string().datetime(),
});

export type ConfirmationAttachmentReview = z.infer<typeof confirmationAttachmentReviewSchema>;
export type WriteConfirmationRequest = z.infer<typeof writeConfirmationSchema>;

export interface ConfirmationDecision {
  requiresConfirmation: boolean;
  reason: 'read-only' | 'write' | 'destructive' | 'send';
}

export function evaluateWriteConfirmation(risk: GoogleToolRisk): ConfirmationDecision {
  switch (risk) {
    case 'read': return { requiresConfirmation: false, reason: 'read-only' };
    case 'write': return { requiresConfirmation: true, reason: 'write' };
    case 'destructive': return { requiresConfirmation: true, reason: 'destructive' };
    case 'send': return { requiresConfirmation: true, reason: 'send' };
  }
}

export function isConfirmationFresh(requestedAt: string, now = new Date(), maxAgeMs = 5 * 60_000): boolean {
  const timestamp = Date.parse(requestedAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp <= maxAgeMs;
}
