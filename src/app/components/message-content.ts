import type { ChatMessage } from '../../domain/chat';

/**
 * Whether a chat message has user-visible payload beyond its metadata/actions.
 * Structured results are first-class message content: an assistant response does
 * not become empty merely because it contains no prose.
 */
export function hasRenderableMessageContent(message: Pick<ChatMessage, 'text' | 'attachments' | 'artifacts' | 'media'>): boolean {
  return message.text.trim().length > 0
    || Boolean(message.attachments?.length)
    || Boolean(message.artifacts?.length)
    || Boolean(message.media?.length);
}
