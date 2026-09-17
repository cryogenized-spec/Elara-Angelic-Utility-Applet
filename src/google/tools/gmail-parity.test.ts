import { describe, expect, it, vi } from 'vitest';
import type { GoogleCapabilityKey, GoogleOAuthAuthority } from '../oauth/contracts';
import { confirmationRequestForCall, executeGoogleTool, type GoogleToolExecutionContext } from './executor';
import { googleGeminiFunctionDeclarations, googleGeminiFunctionNames } from './gemini-declarations';
import { validateGmailToolArguments } from './gmail-schemas';
import { googleToolRegistry } from './registry';

function oauthFor(...capabilities: GoogleCapabilityKey[]): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: async () => new Response('{}', { status: 200 }) }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: capabilities, enabledCapabilities: capabilities, grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}
function declaration(name: string) {
  const found = googleGeminiFunctionDeclarations.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing declaration ${name}`);
  return found;
}

describe('Gmail Pass 3 tool parity', () => {
  it('advertises the semantic Gmail surface including a dedicated reply tool', () => {
    expect(googleGeminiFunctionNames()).toEqual(expect.arrayContaining([
      'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel',
      'gmail.modifyMessage', 'gmail.modifyThread', 'gmail.trashMessage', 'gmail.untrashMessage', 'gmail.trashThread', 'gmail.untrashThread',
      'gmail.createLabel', 'gmail.updateLabel', 'gmail.deleteLabel', 'gmail.sendMessage', 'gmail.replyMessage',
    ]));
    expect(googleToolRegistry.find((entry) => entry.name === 'gmail.replyMessage')).toMatchObject({ risk: 'send', capability: 'gmail.send', exposure: 'gemini' });
  });

  it('keeps declarations aligned to semantic actions rather than raw provider label arrays/resources', () => {
    const modify = declaration('gmail.modifyMessage').parameters;
    expect(modify.required).toEqual(['messageId', 'action']);
    expect(modify.properties).toHaveProperty('action');
    expect(modify.properties).not.toHaveProperty('addLabelIds');
    expect(modify.properties).not.toHaveProperty('removeLabelIds');

    const createLabel = declaration('gmail.createLabel').parameters;
    expect(createLabel.required).toEqual(['name']);
    expect(createLabel.properties).toHaveProperty('name');
    expect(createLabel.properties).not.toHaveProperty('label');

    const send = declaration('gmail.sendMessage').parameters;
    expect(send.properties).not.toHaveProperty('threadId');
    expect(declaration('gmail.replyMessage').parameters.required).toEqual(['threadId', 'to', 'subject', 'body', 'inReplyTo']);
  });

  it('rejects raw mutation shapes and malformed reply/send headers before confirmation', () => {
    expect(() => validateGmailToolArguments('gmail.modifyMessage', { messageId: 'm1', addLabelIds: ['STARRED'] })).toThrow();
    expect(() => validateGmailToolArguments('gmail.createLabel', { label: { name: 'Projects' } })).toThrow();
    expect(() => validateGmailToolArguments('gmail.sendMessage', { to: ['a@example.com'], subject: 'Hi\r\nBcc: thief@example.com', body: 'x' })).toThrow();
    expect(() => validateGmailToolArguments('gmail.replyMessage', { threadId: 't1', to: 'a@example.com', subject: 'Re: Hi', body: 'x', inReplyTo: 'not-a-message-id' })).toThrow();
  });

  it('requires USER label ids only for custom-label actions', () => {
    expect(validateGmailToolArguments('gmail.modifyMessage', { messageId: 'm1', action: 'archive' })).toMatchObject({ action: 'archive' });
    expect(() => validateGmailToolArguments('gmail.modifyMessage', { messageId: 'm1', action: 'archive', labelId: 'Label_1' })).toThrow();
    expect(() => validateGmailToolArguments('gmail.modifyMessage', { messageId: 'm1', action: 'applyLabel' })).toThrow();
    expect(validateGmailToolArguments('gmail.modifyMessage', { messageId: 'm1', action: 'applyLabel', labelId: 'Label_1' })).toMatchObject({ labelId: 'Label_1' });
  });

  it('shows exact semantic mailbox actions in confirmation copy', () => {
    expect(confirmationRequestForCall({ tool: 'gmail.modifyMessage', arguments: { messageId: 'm1', action: 'markUnread' } }, new Date('2026-09-17T12:00:00Z'))?.resourceSummary).toContain('markUnread');
    expect(confirmationRequestForCall({ tool: 'gmail.deleteLabel', arguments: { labelId: 'Label_1' } }, new Date('2026-09-17T12:00:00Z'))?.resourceSummary).toContain('messages themselves are not deleted');
  });

  it('exposes the entire send/reply body through reviewText before approval', () => {
    const body = 'First line\nSecond line\nThird line';
    expect(confirmationRequestForCall({ tool: 'gmail.sendMessage', arguments: { to: ['bob@example.com'], subject: 'Hello', body } }, new Date('2026-09-17T12:00:00Z'))).toMatchObject({ risk: 'send', reviewText: body });
    expect(confirmationRequestForCall({ tool: 'gmail.replyMessage', arguments: { threadId: 't1', to: 'bob@example.com', subject: 'Re: Hello', body, inReplyTo: '<m1@example.com>' } }, new Date('2026-09-17T12:00:00Z'))).toMatchObject({ risk: 'send', reviewText: body });
  });

  it('blocks invalid Gmail shapes before capability/confirmation/handler execution', async () => {
    const handler = vi.fn(async () => ({})); const confirm = vi.fn(async () => true);
    const result = await executeGoogleTool(
      { tool: 'gmail.modifyMessage', arguments: { messageId: 'm1', addLabelIds: ['STARRED'] } },
      { oauth: oauthFor('gmail.modify'), handlers: { 'gmail.modifyMessage': handler }, confirm },
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TOOL_CALL' });
    expect(confirm).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
  });

  it('passes only validated semantic Gmail arguments to a handler after approval', async () => {
    const handler = vi.fn(async ({ arguments: args }: GoogleToolExecutionContext) => args); const confirm = vi.fn(async () => true);
    const result = await executeGoogleTool(
      { tool: 'gmail.modifyMessage', arguments: { messageId: 'm1', action: 'star' } },
      { oauth: oauthFor('gmail.modify'), handlers: { 'gmail.modifyMessage': handler }, confirm, now: () => new Date('2026-09-17T12:00:00Z') },
    );
    expect(result).toMatchObject({ ok: true, result: { messageId: 'm1', action: 'star' } });
    expect(confirm).toHaveBeenCalledOnce();
  });
});
