import type { NormalizedProviderError } from './errors';
import type { EffectiveGeminiSettings } from './settings-engine';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export type GeminiStreamEvent =
  | { type: 'interaction-created'; interactionId: string; model: string }
  | { type: 'interaction-status'; interactionId: string; status: string }
  | { type: 'step-start'; index: number; stepType: string }
  | { type: 'tool-call'; interactionId: string; index: number; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'thought-summary-delta'; index: number; text: string }
  | { type: 'thought-signature'; index: number; signature: string }
  | { type: 'step-stop'; index: number }
  | { type: 'completed'; interactionId: string; status: string; durationMs: number; usage?: GeminiUsage }
  | { type: 'cancelled'; interactionId?: string }
  | { type: 'failed'; error: NormalizedProviderError }
  | { type: 'error'; message: string; error?: NormalizedProviderError };

export interface GeminiUsage { inputTokens?: number; outputTokens?: number; cachedTokens?: number; thoughtsTokens?: number; totalTokens?: number; thoughtSummary?: string; }

export interface GeminiToolResult {
  callId: string;
  name: string;
  result: unknown;
}

export interface GeminiTurnRequest {
  model: string;
  input: string;
  previousInteractionId?: string;
  generationConfig?: EffectiveGeminiSettings;
  systemInstruction?: string;
  tools?: readonly string[];
}

export interface GeminiToolContinuationRequest {
  model: string;
  previousInteractionId: string;
  result: GeminiToolResult;
  systemInstruction?: string;
  generationConfig?: EffectiveGeminiSettings;
  tools?: readonly string[];
}

export interface GeminiTurnPort {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent>;
  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent>;
}
