import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestCode = vi.fn();
type CodeClientConfig = {
  callback?: (response: { code?: string; scope?: string; state?: string; error?: string; error_description?: string }) => void;
};
let capturedConfig: CodeClientConfig | undefined;
const initCodeClient = vi.fn((config: CodeClientConfig) => {
  capturedConfig = config;
  return { requestCode };
});

vi.mock('./gis', () => ({
  loadGoogleIdentityServices: vi.fn(async () => ({ accounts: { oauth2: { initCodeClient } } })),
}));

import { loadGoogleIdentityServices } from './gis';
import { requestGoogleAuthorizationCode } from './code-flow';

const loadMock = vi.mocked(loadGoogleIdentityServices);

describe('requestGoogleAuthorizationCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig = undefined;
    Object.defineProperty(window, 'google', { value: { accounts: { oauth2: { initCodeClient } } }, configurable: true });
  });

  it('initializes GIS code UX with incremental authorization and resolves the returned code', async () => {
    requestCode.mockImplementationOnce(() => {
      capturedConfig?.callback?.({ code: 'auth-code-123', scope: 'scope-a scope-b', state: 'state-1' });
    });

    await expect(requestGoogleAuthorizationCode({
      clientId: 'client-id',
      scope: 'scope-a scope-b',
      redirectUri: 'https://auth.example.test/oauth/callback',
      state: 'state-1',
    })).resolves.toEqual({ code: 'auth-code-123', scope: 'scope-a scope-b', state: 'state-1' });

    expect(loadMock).toHaveBeenCalledOnce();
    expect(initCodeClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-id',
      scope: 'scope-a scope-b',
      include_granted_scopes: true,
      ux_mode: 'popup',
      redirect_uri: 'https://auth.example.test/oauth/callback',
      state: 'state-1',
    }));
    expect(requestCode).toHaveBeenCalledOnce();
  });

  it('rejects when GIS returns an authorization error', async () => {
    requestCode.mockImplementationOnce(() => {
      capturedConfig?.callback?.({ error: 'access_denied', error_description: 'User denied access.' });
    });

    await expect(requestGoogleAuthorizationCode({
      clientId: 'client-id',
      scope: 'scope-a',
      redirectUri: 'https://auth.example.test/oauth/callback',
    })).rejects.toThrow('User denied access.');
  });

  it('fails before loading GIS when used outside a browser or without a redirect URI', async () => {
    await expect(requestGoogleAuthorizationCode({ clientId: 'client-id', scope: 'scope-a', redirectUri: '   ' })).rejects.toThrow('redirect URI is required');
  });
});
