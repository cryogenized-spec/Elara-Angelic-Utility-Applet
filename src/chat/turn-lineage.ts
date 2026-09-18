import type { ChatMessage, ConversationState } from '../domain/chat';

/**
 * Resolve multimodal lineage from a stable user-message identity. Input text
 * is intentionally not part of this lookup: repeated prompts are valid and
 * must not inherit one another's attachments.
 */
export function attachmentsForTurn(
  conversation: ConversationState,
  inputMessageId: string | undefined,
  explicitAttachments?: readonly string[],
): readonly string[] | undefined {
  if (explicitAttachments !== undefined) return explicitAttachments;
  if (!inputMessageId) return undefined;
  return conversation.messages.find((message) => message.id === inputMessageId && message.role === 'user')?.attachments;
}

export function userMessageForTurn(conversation: ConversationState, inputMessageId: string | undefined): ChatMessage | undefined {
  if (!inputMessageId) return undefined;
  const message = conversation.messages.find((candidate) => candidate.id === inputMessageId);
  return message?.role === 'user' ? message : undefined;
}
