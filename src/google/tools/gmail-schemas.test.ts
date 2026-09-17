import { describe, expect, it } from 'vitest';
import { validateGmailToolArguments } from './gmail-schemas';

describe('Gmail semantic mutation schemas', () => {
  it('exposes semantic mailbox actions instead of raw label arrays', () => {
    expect(validateGmailToolArguments('gmail.modifyMessage', {
      messageId: 'message-1', action: 'archive',
    })).toMatchObject({ messageId: 'message-1', action: 'archive' });

    expect(() => validateGmailToolArguments('gmail.modifyMessage', {
      messageId: 'message-1', addLabelIds: ['STARRED'],
    })).toThrow();
    expect(() => validateGmailToolArguments('gmail.modifyThread', {
      threadId: 'thread-1', removeLabelIds: ['INBOX'],
    })).toThrow();
  });

  it('requires labelId only for USER-label actions', () => {
    expect(() => validateGmailToolArguments('gmail.modifyMessage', {
      messageId: 'message-1', action: 'applyLabel',
    })).toThrow(/requires a Gmail USER label id/i);
    expect(() => validateGmailToolArguments('gmail.modifyMessage', {
      messageId: 'message-1', action: 'archive', labelId: 'Label_1',
    })).toThrow(/only valid with applyLabel or removeLabel/i);
    expect(validateGmailToolArguments('gmail.modifyThread', {
      threadId: 'thread-1', action: 'removeLabel', labelId: 'Label_1',
    })).toMatchObject({ action: 'removeLabel', labelId: 'Label_1' });
  });

  it('accepts label names but rejects raw label resources', () => {
    expect(validateGmailToolArguments('gmail.createLabel', { name: 'Projects/Elara' }))
      .toEqual({ name: 'Projects/Elara' });
    expect(validateGmailToolArguments('gmail.updateLabel', { labelId: 'Label_1', name: 'Projects/Elara' }))
      .toEqual({ labelId: 'Label_1', name: 'Projects/Elara' });
    expect(() => validateGmailToolArguments('gmail.createLabel', {
      label: { name: 'Unsafe raw resource', labelListVisibility: 'labelHide' },
    })).toThrow();
  });

  it('rejects header injection and invalid recipients before send', () => {
    expect(() => validateGmailToolArguments('gmail.sendMessage', {
      to: ['not-an-email'], subject: 'Hello', body: 'Body',
    })).toThrow();
    expect(() => validateGmailToolArguments('gmail.sendMessage', {
      to: ['person@example.com'], subject: 'Hello\r\nBcc: attacker@example.com', body: 'Body',
    })).toThrow(/CR\/LF/i);
    expect(() => validateGmailToolArguments('gmail.sendMessage', {
      to: ['person@example.com'], subject: 'Hello', body: 'Body', threadId: 'thread-1',
    })).toThrow();
  });

  it('keeps new-message send separate from RFC-threaded reply', () => {
    expect(validateGmailToolArguments('gmail.replyMessage', {
      threadId: 'thread-1',
      to: 'sender@example.com',
      subject: 'Original subject',
      body: 'Reply body',
      inReplyTo: '<original@example.com>',
      references: ['<root@example.com>', '<original@example.com>'],
    })).toMatchObject({ threadId: 'thread-1', to: 'sender@example.com' });

    expect(() => validateGmailToolArguments('gmail.replyMessage', {
      threadId: 'thread-1',
      to: 'sender@example.com',
      subject: 'Original subject',
      body: 'Reply body',
      inReplyTo: 'not-a-message-id',
    })).toThrow(/Message-ID/i);
  });
});
