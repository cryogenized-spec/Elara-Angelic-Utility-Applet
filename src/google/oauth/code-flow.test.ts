import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestCode = vi.fn();
type CodeClientConfig = {
  redirect_uri?: string;
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

  it('initializes GIS popup code UX with incremental authorization and lets GIS bind redirect_uri to the page origin', async () => {
    requestCode.mockImplementationOnce(() => {
      capturedConfig?.callback?.({ code: 'auth-code-123', scope: 'scope-a scope-b', state: 'state-1' });
    });

    await expect(requestGoogleAuthorizationCode({
      clientId: 'client-id',
      scope: 'scope-a scope-b',
      state: 'state-1',
    })).resolves.toEqual({ code: 'auth-code-123', scope: 'scope-a scope-b', state: 'state-1' });

    expect(loadMock).toHaveBeenCalledOnce();
    expect(initCodeClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-id',
      scope: 'scope-a scope-b',
      include_granted_scopes: true,
      ux_mode: 'popup',
      state: 'state-1',
    }));
    expect(initCodeClient).toHaveBeenCalledWith(expect.not.objectContaining({ redirect_uri: expect.anything() }));
    expect(requestCode).toHaveBeenCalledOnce();
  });

  it('rejects when GIS returns an authorization error', async () => {
    requestCode.mockImplementationOnce(() => {
      capturedConfig?.callback?.({ error: 'access_denied', error_description: 'User denied access.' });
    });

    await expect(requestGoogleAuthorizationCode({
      clientId: 'client-id',
      scope: 'scope-a',
    })).rejects.toThrow('User denied access.');
  });
});
