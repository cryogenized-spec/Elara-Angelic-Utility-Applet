import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../autonomy/cloud/pairing', () => ({
  loadPairing: vi.fn(),
  resolvePairingToken: vi.fn(),
}));

import { loadPairing, resolvePairingToken } from '../../autonomy/cloud/pairing';
import { clickUpOAuthAuthority, loadStoredClickUpStatus } from './authority';

const pairingMock = vi.mocked(loadPairing);
const pairingTokenMock = vi.mocked(resolvePairingToken);

const TEST_PAIRING = {
  workerUrl: 'https://worker.example',
  token: '',
  installationId: 'test-installation',
  workerVersion: 'test',
  schemaVersion: 1,
  pairedAt: 1,
  lastSyncedAt: null,
  lastSyncedContextHash: null,
  lastPulledRunsAt: 0,
  lastPulledRunsId: '',
  lastPulledEventsAt: 0,
  lastPulledEventsId: '',
};

const STATUS = {
  connected: true,
  account: { id: '183', username: 'Gareth', email: 'gareth@example.com' },
  workspaces: [{
    id: '999',
    name: 'Neon Sales',
    members: [{ id: '183', username: 'Gareth', email: 'gareth@example.com' }],
  }],
  updatedAt: 123456,
};

describe('ClickUp OAuth browser authority', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    pairingMock.mockReturnValue(TEST_PAIRING);
    pairingTokenMock.mockResolvedValue('installation-token-for-test');
  });

  it('requires a paired Worker before ClickUp authorization', async () => {
    pairingMock.mockReturnValue(null);
    await expect(clickUpOAuthAuthority.beginConnect('https://cryogenized-spec.github.io/clickup/oauth/callback'))
      .rejects.toThrow(/paired self-hosted Worker/i);
  });

  it('starts authorization with a signed Worker write and never stores credentials', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe('https://worker.example/clickup/oauth/start');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer installation-token-for-test');
      expect(headers.get('X-Elara-Timestamp')).toBeTruthy();
      expect(headers.get('X-Elara-Nonce')).toBeTruthy();
      expect(headers.get('X-Elara-Signature')).toBeTruthy();
      expect(JSON.parse(String(init?.body))).toEqual({
        redirectUri: 'https://cryogenized-spec.github.io/clickup/oauth/callback',
      });
      return new Response(JSON.stringify({
        authorizationUrl: 'https://app.clickup.com/api?client_id=abc&state=opaque-state-value',
        state: 'opaque-state-value',
        expiresAt: Date.now() + 600_000,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const started = await clickUpOAuthAuthority.beginConnect('https://cryogenized-spec.github.io/clickup/oauth/callback');
    expect(started.authorizationUrl).toContain('https://app.clickup.com/api');
    expect(localStorage.getItem('elara.clickup.authorization.v1')).toBeNull();
  });

  it('persists only non-secret connection metadata after exchange', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe('https://worker.example/clickup/oauth/exchange');
      return new Response(JSON.stringify(STATUS), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const status = await clickUpOAuthAuthority.completeConnect({
      code: 'authorization-code',
      state: 'opaque-state-value',
      redirectUri: 'https://cryogenized-spec.github.io/clickup/oauth/callback',
    });
    expect(status).toEqual(STATUS);
    const raw = localStorage.getItem('elara.clickup.authorization.v1') ?? '';
    expect(raw).toContain('Neon Sales');
    expect(raw).not.toContain('authorization-code');
    expect(loadStoredClickUpStatus()).toEqual(STATUS);
  });

  it('refreshes status with bearer admission and clears metadata on disconnect', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer installation-token-for-test');
      if (url.endsWith('/clickup/oauth/status')) {
        return new Response(JSON.stringify(STATUS), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/clickup/oauth/disconnect')) {
        return new Response(JSON.stringify({ disconnected: true, providerRevoked: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(STATUS);
    expect(loadStoredClickUpStatus()).toEqual(STATUS);
    await clickUpOAuthAuthority.disconnect();
    expect(loadStoredClickUpStatus()).toBeNull();
    expect(calls).toBe(2);
  });
});
