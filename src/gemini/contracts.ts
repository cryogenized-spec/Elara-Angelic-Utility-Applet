import type { NormalizedProviderError } from './errors';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export type GeminiStreamEvent =
  | { type: 'interaction-created'; interactionId: string; model: string }
  | { type: 'interaction-status'; interactionId: string; status: string }
  | { type: 'step-start'; index: number; stepType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'thought-summary-delta'; index: number; text: string }
  | { type: 'step-stop'; index: number }
  | { type: 'completed'; interactionId: string; status: string; durationMs: number; usage?: GeminiUsage }
  | { type: 'cancelled'; interactionId?: string }
  | { type: 'failed'; error: NormalizedProviderError };

export interface GeminiUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
}

export interface GeminiTurnRequest {
  model?: string;
  input: string;
  previousInteractionId?: string;
}

export interface GeminiTurnPort {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent>;
}
