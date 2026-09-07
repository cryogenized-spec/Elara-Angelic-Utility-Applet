import { describe, expect, it } from 'vitest';
import { GoogleChatService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleChatService', () => {
  it('separates Chat reads from writes', async () => {
    const capabilities: string[] = [];
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async () => {
          capabilities.push(capability);
          return new Response(JSON.stringify({ name: 'spaces/1/messages/1' }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleChatService(oauth);
    await service.getMessage('spaces/1/messages/1');
    await service.updateMessage('spaces/1/messages/1', { text: 'Updated' }, 'text');
    expect(capabilities).toEqual(['chat.read', 'chat.write']);
  });

  it('rejects oversized Chat list inputs before authorization', async () => {
    let authorizeCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorizeCalls += 1;
        return { capability, fetch: async () => new Response('{}', { status: 200 }) };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleChatService(oauth);

    await expect(service.listMessages('x'.repeat(501))).rejects.toThrow('space name is too long');
    await expect(service.listMessages('spaces/1', 101)).rejects.toThrow('pageSize');
    expect(authorizeCalls).toBe(0);
  });
});
