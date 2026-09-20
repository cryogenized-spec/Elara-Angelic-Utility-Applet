import type { NormalizedProviderError } from './errors';
import type { EffectiveGeminiSettings } from './settings-engine';
import type { MediaItem, MediaProviderId } from '../domain/media';

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
  /** Application-owned activity outside the provider's reasoning/tool steps. */
  | { type: 'context-activity'; category: 'memory' | 'artifacts' | 'other'; label: string; detail?: string; durationMs: number; outcome: 'used' | 'empty' | 'unavailable' | 'completed' }
  | { type: 'artifact-created'; artifactId: string; status: string; mimeType: string; toolName?: string; operationId?: string }
  /**
   * Resolved media from a media tool call. Carries the structured items directly
   * so the card is driven by data, never by parsing the assistant's prose.
   */
  | { type: 'media-resolved'; provider: MediaProviderId; queries: readonly string[]; items: readonly MediaItem[] }
  /** Provider-reported usage for one interaction, including requires_action continuations. */
  | { type: 'interaction-usage'; interactionId: string; status: string; usage: GeminiUsage; source: 'provider' }
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
  /** Stable local artifact IDs; provider adapters resolve binary data. */
  attachments?: readonly string[];
  previousInteractionId?: string;
  generationConfig?: EffectiveGeminiSettings;
  systemInstruction?: string;
  tools?: readonly string[];
  /**
   * Application-owned turn provenance. These identifiers are never provider
   * arguments; local mutation handlers use them to bind durable effects to the
   * exact conversation and originating user message that elected this turn.
   */
  conversationId?: string;
  inputMessageId?: string;
  /**
   * Memory context composition mode. `'thread'` (default, interactive chat)
   * appends the active thread's durable-memory projection inside the provider
   * boundary. `'none'` passes the caller's system instruction through
   * verbatim — used by non-chat callers (autonomous routine runs) that own
   * their own memory scoping.
   */
  memoryContext?: 'thread' | 'none';
  /**
   * Application-owned provenance for provider-derived context already present
   * before the model's first tool batch. Consumed only by the local tool loop;
   * it is not serialized as a Gemini provider argument.
   */
  untrustedExternalContext?: boolean;
  /** Existing app generation arbiter context for artifact-producing work. */
  generationId?: string;
  isGenerationActive?: () => boolean;
}

export interface GeminiToolContinuationRequest {
  model: string;
  previousInteractionId: string;
  result?: GeminiToolResult;
  results?: readonly GeminiToolResult[];
  systemInstruction?: string;
  generationConfig?: EffectiveGeminiSettings;
  tools?: readonly string[];
}

export interface GeminiTurnPort {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent>;
  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent>;
}
