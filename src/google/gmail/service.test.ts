import { describe, expect, it } from 'vitest';
import { GoogleGmailService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleGmailService', () => {
  it('separates read, modify, and send capabilities', async () => {
    const capabilities: string[] = [];
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async () => {
          capabilities.push(capability);
          return new Response(JSON.stringify({ messages: [{ id: 'msg-1', threadId: 'thread-1' }] }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleGmailService(oauth);
    await service.listMessages('from:alice@example.com');
    await service.modifyMessage('msg-1', ['STARRED']);
    await service.sendMessage('To: bob@example.com\r\nSubject: Test\r\n\r\nHello');

    expect(capabilities).toEqual(['gmail.read', 'gmail.modify', 'gmail.send']);
  });
});
