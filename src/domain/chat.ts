import type { MediaItem } from './media';

export type ChatRole = 'user' | 'assistant' | 'system';
export type ProviderStatus = 'idle' | 'streaming' | 'saving' | 'failed';

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
  thoughtSummary?: string;
}

export interface ProviderTurnMetadata {
  provider: 'gemini';
  model: string;
  interactionId: string;
  startedAt: number;
  completedAt: number;
  durationMs?: number;
  usage?: ProviderUsage;
  /** Chat-layer turn identity; one generation may span many interactions. */
  generationId?: string;
  /** Previous generation this turn supersedes (regeneration / retry). */
  supersedesGenerationId?: string;
}

export type GenerationActivityKind = 'thinking' | 'tool' | 'generation' | 'context' | 'status';
export type GenerationActivityState = 'done' | 'failed' | 'cancelled';
export type GenerationContextCategory = 'memory' | 'artifacts' | 'other';

/**
 * Durable, provider-agnostic record of one observable generation activity.
 * Raw hidden chain-of-thought is never stored here; `detail` is limited to
 * provider-supplied thought summaries or application-owned status text.
 */
export interface GenerationActivityStep {
  id: string;
  kind: GenerationActivityKind;
  state: GenerationActivityState;
  durationMs: number;
  label: string;
  detail?: string;
  toolName?: string;
  contextCategory?: GenerationContextCategory;
  errorCode?: string;
}

/** Terminal snapshot used by the same UI that renders the live generation. */
export interface GenerationActivityRecord {
  id: string;
  durationMs: number;
  steps: GenerationActivityStep[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  conversationId?: string;
  responseGroupId?: string;
  responseVariant?: number;
  /** Stable artifact IDs; binary payloads live in the artifact repository. */
  attachments?: string[];
  artifacts?: string[];
  /**
   * Resolved media from a media tool call, kept with the message so a media card
   * survives a reload. Optional and unindexed, so adding it needs no Dexie
   * version bump. Never contains credential material.
   */
  media?: MediaItem[];
  generationActivity?: GenerationActivityRecord;
  providerTurn?: ProviderTurnMetadata;
}

export interface ConversationState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}
