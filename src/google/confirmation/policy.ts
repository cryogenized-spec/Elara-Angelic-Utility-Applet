import { z } from 'zod';
import type { GoogleToolRisk } from '../tools/contracts';

export const writeConfirmationSchema = z.object({
  tool: z.string().min(1),
  risk: z.enum(['write', 'destructive', 'send']),
  resourceSummary: z.string().min(1),
  requestedAt: z.string().datetime(),
});

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
