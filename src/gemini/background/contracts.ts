import { z } from 'zod';

export const backgroundInteractionStatusSchema = z.enum([
  'in_progress',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
]);

export type BackgroundInteractionStatus = z.infer<typeof backgroundInteractionStatusSchema>;

export const backgroundInteractionRefSchema = z.object({
  interactionId: z.string().min(1),
  status: backgroundInteractionStatusSchema,
  createdAt: z.string().datetime(),
});

export type BackgroundInteractionRef = z.infer<typeof backgroundInteractionRefSchema>;

export interface GeminiBackgroundExecutor {
  start(input: unknown): Promise<BackgroundInteractionRef>;
  get(interactionId: string): Promise<BackgroundInteractionRef>;
  cancel(interactionId: string): Promise<void>;
}
