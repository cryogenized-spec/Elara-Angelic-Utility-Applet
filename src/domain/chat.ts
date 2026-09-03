export type ChatRole = 'user' | 'assistant' | 'system';
export type ProviderStatus = 'idle' | 'streaming' | 'failed';

export interface ExecutionSummary {
  id: string;
  steps: string[];
  durationMs: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  executionSummary?: ExecutionSummary;
}

export interface ConversationState {
  id: string;
  messages: ChatMessage[];
}
