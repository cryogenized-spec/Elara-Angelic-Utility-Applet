export type ChatRole = 'user' | 'assistant' | 'system';
export type ProviderStatus = 'idle' | 'streaming' | 'failed';

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
}

export interface ExecutionSummary {
  id: string;
  steps: string[];
  durationMs: number;
  thoughtSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  conversationId?: string;
  responseGroupId?: string;
  responseVariant?: number;
  executionSummary?: ExecutionSummary;
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
