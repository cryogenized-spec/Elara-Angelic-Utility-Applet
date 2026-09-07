import { describe, expect, it } from 'vitest';
import { GoogleGmailService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleGmailService', () => {
  it('separates read, modify, label administration, and send capabilities', async () => {
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
    await service.createLabel({ name: 'Important' });
    await service.updateLabel('Label_1', { name: 'Important' });
    await service.deleteLabel('Label_1');
    await service.sendMessage('To: bob@example.com\r\nSubject: Test\r\n\r\nHello');

    expect(capabilities).toEqual(['gmail.read', 'gmail.modify', 'gmail.labels', 'gmail.labels', 'gmail.labels', 'gmail.send']);
  });

  it('rejects oversized Gmail search inputs before contacting the authority fetcher', async () => {
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({ capability, fetch: async () => new Response('{}', { status: 200 }) }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleGmailService(oauth);

    await expect(service.listMessages('x'.repeat(2001))).rejects.toThrow('search query is too long');
  });

  it('rejects oversized outbound messages before authorization is requested', async () => {
    let authorizeCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorizeCalls += 1;
        return { capability, fetch: async () => new Response('{}', { status: 200 }) };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleGmailService(oauth);

    await expect(service.sendMessage('x'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow('size limit');
    expect(authorizeCalls).toBe(0);
  });
});
