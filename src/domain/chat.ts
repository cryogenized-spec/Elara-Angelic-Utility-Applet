export type ChatRole = 'user' | 'assistant' | 'system';
export type ProviderStatus = 'idle' | 'streaming' | 'failed';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
}

export interface ConversationState {
  id: string;
  messages: ChatMessage[];
}
