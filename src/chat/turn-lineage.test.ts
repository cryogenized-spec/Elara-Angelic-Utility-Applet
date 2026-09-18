import { describe, expect, it } from 'vitest';
import type { ConversationState } from '../domain/chat';
import { attachmentsForTurn, userMessageForTurn } from './turn-lineage';

const conversation: ConversationState = {
  id: 'thread-1',
  title: 'Receipts',
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: 'user-one', role: 'user', text: 'Please inspect this.', createdAt: 1, conversationId: 'thread-1', attachments: ['receipt-a'] },
    { id: 'assistant-one', role: 'assistant', text: 'First answer', createdAt: 2, conversationId: 'thread-1' },
    { id: 'user-two', role: 'user', text: 'Please inspect this.', createdAt: 3, conversationId: 'thread-1', attachments: ['receipt-b'] },
  ],
};

describe('turn attachment lineage', () => {
  it('uses the stable user-message ID when repeated prompts have different attachments', () => {
    expect(attachmentsForTurn(conversation, 'user-two')).toEqual(['receipt-b']);
    expect(attachmentsForTurn(conversation, 'user-one')).toEqual(['receipt-a']);
  });

  it('does not infer attachment lineage from text or an assistant message', () => {
    expect(attachmentsForTurn(conversation, undefined)).toBeUndefined();
    expect(attachmentsForTurn(conversation, 'assistant-one')).toBeUndefined();
  });

  it('preserves an explicitly supplied attachment set', () => {
    expect(attachmentsForTurn(conversation, 'user-one', ['replacement'])).toEqual(['replacement']);
  });

  it('returns only a user message for a valid lineage identity', () => {
    expect(userMessageForTurn(conversation, 'user-two')?.id).toBe('user-two');
    expect(userMessageForTurn(conversation, 'assistant-one')).toBeUndefined();
  });
});
