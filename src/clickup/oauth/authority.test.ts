import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../autonomy/cloud/pairing', () => ({
  loadPairing: vi.fn(),
  resolvePairingToken: vi.fn(),
}));

import { loadPairing, resolvePairingToken } from '../../autonomy/cloud/pairing';
import { CLICKUP_CONNECTION_SETTLE_MS, clickUpOAuthAuthority, loadStoredClickUpStatus } from './authority';

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
  }],
  updatedAt: 123456,
};

function connectionState(epoch = 0, pending = false, intentTimestamp = Date.now()) {
  return {
    epoch,
    settledEpoch: pending ? Math.max(0, epoch - 1) : epoch,
    pending,
    intentTimestamp,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

  it('fails closed if the pairing changes while the installation credential is resolving', async () => {
    pairingTokenMock.mockImplementationOnce(async () => {
      pairingMock.mockReturnValue({
        ...TEST_PAIRING,
        workerUrl: 'https://replacement.example',
        installationId: 'replacement-installation',
      });
      return 'stale-installation-token';
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.beginConnect(
      'https://cryogenized-spec.github.io/clickup/oauth/callback',
    )).rejects.toMatchObject({
      code: 'grant_changed',
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response if the paired Worker changes while the request is in flight', async () => {
    globalThis.fetch = vi.fn(async () => {
      pairingMock.mockReturnValue({
        ...TEST_PAIRING,
        workerUrl: 'https://replacement.example',
        installationId: 'replacement-installation',
      });
      return new Response(JSON.stringify({
        authorizationUrl: 'https://app.clickup.com/api?client_id=abc&state=stale-state-value',
        state: 'stale-state-value',
        expiresAt: Date.now() + 600_000,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.beginConnect(
      'https://cryogenized-spec.github.io/clickup/oauth/callback',
    )).rejects.toMatchObject({
      code: 'grant_changed',
      status: 409,
    });
    expect(localStorage.getItem('elara.clickup.authorization.v1')).toBeNull();
  });

  it('does not let a superseded pairing read erase newer pairing cached status', async () => {
    const replacementPairing = {
      ...TEST_PAIRING,
      workerUrl: 'https://replacement.example',
      installationId: 'replacement-installation',
    };
    const replacementStatus = {
      ...STATUS,
      account: { id: '456', username: 'Replacement', email: 'replacement@example.com' },
      workspaces: [{ id: '1000', name: 'Replacement Workspace' }],
      updatedAt: 234567,
    };

    let releaseOldStatus: ((response: Response) => void) | undefined;
    const oldStatusResponse = new Promise<Response>((resolve) => { releaseOldStatus = resolve; });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'https://worker.example/clickup/oauth/connection-state') {
        return jsonResponse(connectionState());
      }
      if (url === 'https://worker.example/clickup/oauth/status') return oldStatusResponse;
      if (url === 'https://replacement.example/clickup/oauth/connection-state') {
        return jsonResponse(connectionState(5));
      }
      if (url === 'https://replacement.example/clickup/oauth/status') {
        return jsonResponse(replacementStatus);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const staleRead = clickUpOAuthAuthority.getStatus();
    await Promise.resolve();
    await Promise.resolve();
    pairingMock.mockReturnValue(replacementPairing);

    await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(replacementStatus);
    expect(loadStoredClickUpStatus()).toEqual(replacementStatus);

    releaseOldStatus?.(jsonResponse(STATUS));
    await expect(staleRead).rejects.toMatchObject({ code: 'grant_changed', status: 409 });

    expect(loadStoredClickUpStatus()).toEqual(replacementStatus);
  });

  it('rejects a status snapshot when another tab changes the Worker connection epoch mid-read', async () => {
    let stateReads = 0;
    let releaseStatus: ((response: Response) => void) | undefined;
    const delayedStatus = new Promise<Response>((resolve) => { releaseStatus = resolve; });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        stateReads += 1;
        return jsonResponse(connectionState(stateReads === 1 ? 7 : 8));
      }
      if (url.endsWith('/clickup/oauth/status')) return delayedStatus;
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const pending = clickUpOAuthAuthority.getStatus();
    await Promise.resolve();
    await Promise.resolve();
    releaseStatus?.(jsonResponse(STATUS));

    await expect(pending).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(loadStoredClickUpStatus()).toBeNull();
    expect(stateReads).toBe(2);
  });

  it('rejects a status snapshot if the browser connection generation changes before persistence', async () => {
    let stateReads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        stateReads += 1;
        if (stateReads === 2) {
          localStorage.setItem('elara.clickup.connection.generation.v1', JSON.stringify({
            authorityBinding: 'https://worker.example#test-installation',
            generationId: 'newer-tab-operation',
          }));
        }
        return jsonResponse(connectionState(11));
      }
      if (url.endsWith('/clickup/oauth/status')) return jsonResponse(STATUS);
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getStatus()).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(loadStoredClickUpStatus()).toBeNull();
    expect(stateReads).toBe(2);
  });

  it('ignores legacy unowned cached ClickUp status until the current pairing refreshes it', () => {
    localStorage.setItem('elara.clickup.authorization.v1', JSON.stringify(STATUS));
    expect(loadStoredClickUpStatus()).toBeNull();
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

  it('reads ClickUp connection methods from the separate capability endpoint', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe('https://worker.example/clickup/oauth/methods');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer installation-token-for-test');
      return new Response(JSON.stringify({ oauth: false, personalToken: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getConnectionMethods()).resolves.toEqual({
      oauth: false,
      personalToken: true,
    });
  });

  it('treats an older Worker without the methods endpoint as OAuth-only', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 'not_found',
      message: 'Not found.',
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getConnectionMethods()).resolves.toEqual({
      oauth: true,
      personalToken: false,
    });
  });

  it('activates a Worker-configured personal token without sending token material from the browser', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toBe('https://worker.example/clickup/oauth/personal-token');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({});
      expect(String(init?.body)).not.toContain('pk_');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer installation-token-for-test');
      expect(headers.get('X-Elara-Signature')).toBeTruthy();
      return new Response(JSON.stringify(STATUS), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const status = await clickUpOAuthAuthority.connectPersonalToken();
    expect(status).toEqual(STATUS);
    const raw = localStorage.getItem('elara.clickup.authorization.v1') ?? '';
    expect(raw).toContain('Neon Sales');
    expect(raw).not.toContain('pk_');
  });

  it('does not clear a pre-egress pending marker when the Worker has not admitted that intent yet', async () => {
    let releaseToken: ((token: string) => void) | undefined;
    pairingTokenMock
      .mockImplementationOnce(() => new Promise<string>((resolve) => { releaseToken = resolve; }))
      .mockResolvedValue('installation-token-for-test');

    let statusReads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        // Settled Worker state, but watermark 0 proves the browser operation
        // has not actually reached this Worker yet.
        return jsonResponse(connectionState(0, false, 0));
      }
      if (url.endsWith('/clickup/oauth/status')) {
        statusReads += 1;
        return jsonResponse(STATUS);
      }
      if (url.endsWith('/clickup/oauth/personal-token')) {
        return jsonResponse({
          code: 'connection_superseded',
          message: 'Superseded for test cleanup.',
        }, 409);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const pendingConnect = clickUpOAuthAuthority.connectPersonalToken();
    for (let attempt = 0; attempt < 100 && !localStorage.getItem('elara.clickup.connection.pending.v1'); attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const markerBefore = localStorage.getItem('elara.clickup.connection.pending.v1');
    expect(markerBefore).toContain('"intentTimestamp"');

    await expect(clickUpOAuthAuthority.getStatus()).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(statusReads).toBe(0);
    expect(localStorage.getItem('elara.clickup.connection.pending.v1')).toBe(markerBefore);

    releaseToken?.('installation-token-for-test');
    await expect(pendingConnect).rejects.toMatchObject({
      code: 'connection_superseded',
      status: 409,
    });
  });

  it('keeps browser intent ordering when an older tab stalls before network egress', async () => {
    const newerStatus = {
      ...STATUS,
      account: { id: '456', username: 'Newer', email: 'newer@example.com' },
      workspaces: [{ id: '1000', name: 'Newer Workspace' }],
      updatedAt: 234567,
    };

    let releaseOlderToken: ((token: string) => void) | undefined;
    pairingTokenMock
      .mockImplementationOnce(() => new Promise<string>((resolve) => { releaseOlderToken = resolve; }))
      .mockResolvedValue('installation-token-for-test');

    let highestAcceptedIntent = 0;
    const personalIntents: number[] = [];
    const signingTimestamps: number[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return jsonResponse(connectionState());
      }
      if (url.endsWith('/clickup/oauth/personal-token')) {
        const headers = new Headers(init?.headers);
        const signingTimestamp = Number(headers.get('X-Elara-Timestamp'));
        const nonce = headers.get('X-Elara-Nonce') ?? '';
        const match = /^clickup-v1:(\d{13}):[0-9a-f]{32}$/.exec(nonce);
        expect(match).not.toBeNull();
        const intentTimestamp = Number(match?.[1] ?? '0');
        signingTimestamps.push(signingTimestamp);
        personalIntents.push(intentTimestamp);
        if (intentTimestamp <= highestAcceptedIntent) {
          return jsonResponse({
            code: 'connection_superseded',
            message: 'This ClickUp connection action was superseded by a newer signed browser action.',
          }, 409);
        }
        highestAcceptedIntent = intentTimestamp;
        return jsonResponse(newerStatus);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const older = clickUpOAuthAuthority.connectPersonalToken();
    for (let attempt = 0; attempt < 100 && !localStorage.getItem('elara.clickup.connection.pending.v1'); attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(localStorage.getItem('elara.clickup.connection.pending.v1')).toContain('"operationId"');

    // Ensure the second gesture has a strictly later wall-clock intent even on
    // fast CI hosts where both test statements could otherwise share 1 ms.
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const newer = clickUpOAuthAuthority.connectPersonalToken();
    await expect(newer).resolves.toEqual(newerStatus);
    expect(personalIntents).toHaveLength(1);

    releaseOlderToken?.('installation-token-for-test');
    await expect(older).rejects.toMatchObject({
      code: 'connection_superseded',
      status: 409,
    });

    expect(personalIntents).toHaveLength(2);
    // Network arrival is newer first, older second, but the HMAC-covered nonce
    // retains gesture order. Signing freshness may be reversed and is not used
    // as the account-order authority.
    expect(personalIntents[0]).toBeGreaterThan(personalIntents[1]);
    expect(signingTimestamps[1]).toBeGreaterThanOrEqual(signingTimestamps[0]);
    expect(loadStoredClickUpStatus()).toEqual(newerStatus);
  });

  it('does not let an older tab clear a newer tab pending marker on late success', async () => {
    const secondStatus = {
      ...STATUS,
      account: { id: '456', username: 'Second', email: 'second@example.com' },
      workspaces: [{ id: '1000', name: 'Second Workspace' }],
      updatedAt: 234567,
    };

    let personalCalls = 0;
    let releaseFirst: ((response: Response) => void) | undefined;
    let releaseSecond: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    const secondResponse = new Promise<Response>((resolve) => { releaseSecond = resolve; });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return jsonResponse(connectionState(0));
      }
      if (url.endsWith('/clickup/oauth/personal-token')) {
        personalCalls += 1;
        return personalCalls === 1 ? firstResponse : secondResponse;
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const first = clickUpOAuthAuthority.connectPersonalToken();
    for (let attempt = 0; attempt < 100 && personalCalls < 1; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(personalCalls).toBe(1);

    const second = clickUpOAuthAuthority.connectPersonalToken();
    for (let attempt = 0; attempt < 100 && personalCalls < 2; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(personalCalls).toBe(2);

    releaseFirst?.(jsonResponse(STATUS));
    await expect(first).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });

    const pendingRaw = localStorage.getItem('elara.clickup.connection.pending.v1');
    expect(pendingRaw).toContain('"operationId"');
    expect(loadStoredClickUpStatus()).toBeNull();

    releaseSecond?.(jsonResponse(secondStatus));
    await expect(second).resolves.toEqual(secondStatus);
    expect(localStorage.getItem('elara.clickup.connection.pending.v1')).toBeNull();
    expect(loadStoredClickUpStatus()).toEqual(secondStatus);
  });

  it('keeps an ambiguous personal-token activation unknown until the Worker reports the operation settled', async () => {
    const replacement = {
      ...STATUS,
      account: { id: '456', username: 'Replacement', email: 'replacement@example.com' },
      workspaces: [{ id: '1000', name: 'Replacement Workspace' }],
      updatedAt: 234567,
    };
    let operationPending = true;
    let statusReads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/personal-token')) {
        throw new TypeError('response lost after request send');
      }
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return new Response(JSON.stringify({
          epoch: 1,
          settledEpoch: operationPending ? 0 : 1,
          pending: operationPending,
          intentTimestamp: Date.now(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/clickup/oauth/status')) {
        statusReads += 1;
        return new Response(JSON.stringify(replacement), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.connectPersonalToken()).rejects.toMatchObject({ code: 'network' });
    expect(loadStoredClickUpStatus()).toBeNull();

    await expect(clickUpOAuthAuthority.getStatus()).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(statusReads).toBe(0);

    operationPending = false;
    await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(replacement);
    expect(statusReads).toBe(1);
    expect(loadStoredClickUpStatus()).toEqual(replacement);
  });

  it('keeps an ambiguous OAuth exchange out of execution until the Worker reports it settled', async () => {
    let operationPending = true;
    let statusReads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/exchange')) {
        throw new TypeError('response lost after request send');
      }
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return new Response(JSON.stringify({
          epoch: 1,
          settledEpoch: operationPending ? 0 : 1,
          pending: operationPending,
          intentTimestamp: Date.now(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/clickup/oauth/status')) {
        statusReads += 1;
        return new Response(JSON.stringify(STATUS), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.completeConnect({
      code: 'authorization-code',
      state: 'opaque-state-value',
      redirectUri: 'https://cryogenized-spec.github.io/clickup/oauth/callback',
    })).rejects.toMatchObject({ code: 'network' });

    await expect(clickUpOAuthAuthority.getExecutionGrant()).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(statusReads).toBe(0);

    operationPending = false;
    await expect(clickUpOAuthAuthority.getExecutionGrant()).resolves.toEqual(expect.objectContaining({
      status: STATUS,
      revision: STATUS.updatedAt,
    }));
    expect(statusReads).toBe(1);
  });

  it('keeps a legacy pending marker fail-closed even when a new Worker is currently settled', async () => {
    const legacyMarker = {
      authorityBinding: 'https://worker.example#test-installation',
      operationId: 'legacy-operation-id',
      operation: 'personal-token',
      until: Date.now() + CLICKUP_CONNECTION_SETTLE_MS,
    };
    localStorage.setItem('elara.clickup.connection.pending.v1', JSON.stringify(legacyMarker));

    let statusReads = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return jsonResponse(connectionState(9, false, Date.now()));
      }
      if (url.endsWith('/clickup/oauth/status')) {
        statusReads += 1;
        return jsonResponse(STATUS);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getStatus()).rejects.toMatchObject({
      code: 'connection_pending',
      status: 409,
    });
    expect(statusReads).toBe(0);
    expect(localStorage.getItem('elara.clickup.connection.pending.v1')).toBe(JSON.stringify(legacyMarker));
  });

  it('uses the bounded settle timer when an older Worker lacks operation-state reporting', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-22T18:00:00.000Z'));
      let statusReads = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/clickup/oauth/personal-token')) {
          throw new TypeError('response lost after request send');
        }
        if (url.endsWith('/clickup/oauth/connection-state')) {
          return new Response(JSON.stringify({ code: 'not_found', message: 'Not found.' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/clickup/oauth/status')) {
          statusReads += 1;
          return new Response(JSON.stringify(STATUS), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }) as unknown as typeof fetch;

      await expect(clickUpOAuthAuthority.connectPersonalToken()).rejects.toMatchObject({ code: 'network' });
      await expect(clickUpOAuthAuthority.getStatus()).rejects.toMatchObject({ code: 'connection_pending' });
      expect(statusReads).toBe(0);

      await vi.advanceTimersByTimeAsync(CLICKUP_CONNECTION_SETTLE_MS + 1);
      await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(STATUS);
      expect(statusReads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears only the current pairing cache when an ambiguous token activation fails', async () => {
    localStorage.setItem('elara.clickup.authorization.v1', JSON.stringify({
      authorityBinding: 'https://worker.example#test-installation',
      status: STATUS,
    }));
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Worker unreachable');
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.connectPersonalToken()).rejects.toMatchObject({ code: 'network' });
    expect(loadStoredClickUpStatus()).toBeNull();
  });

  it('rejects oversized paired-Worker OAuth responses before schema parsing', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: `https://app.clickup.com/api?${'x'.repeat(70_000)}`,
      state: 'opaque-state-value',
      expiresAt: Date.now() + 600_000,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.beginConnect('https://cryogenized-spec.github.io/clickup/oauth/callback'))
      .rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('keeps the Worker timeout active while an OAuth response body is stalled', async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const abort = () => controller.error(new DOMException('Aborted', 'AbortError'));
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;

      const pending = clickUpOAuthAuthority.getStatus();
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(20_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears stale cached identity when authoritative Worker status cannot be verified', async () => {
    localStorage.setItem('elara.clickup.authorization.v1', JSON.stringify({
      authorityBinding: 'https://worker.example#test-installation',
      status: STATUS,
    }));
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Worker unreachable');
    }) as unknown as typeof fetch;

    await expect(clickUpOAuthAuthority.getStatus()).rejects.toBeInstanceOf(Error);
    expect(loadStoredClickUpStatus()).toBeNull();
  });

  it('refreshes status with bearer admission and clears metadata on disconnect', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer installation-token-for-test');
      if (url.endsWith('/clickup/oauth/connection-state')) {
        return jsonResponse(connectionState());
      }
      if (url.endsWith('/clickup/oauth/status')) {
        return jsonResponse(STATUS);
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
    expect(calls).toBe(4);
  });
});
