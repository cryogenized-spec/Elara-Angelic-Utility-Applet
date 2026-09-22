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

    let releaseOld: ((response: Response) => void) | undefined;
    const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://worker.example/')) return oldResponse;
      if (url.startsWith('https://replacement.example/')) {
        return new Response(JSON.stringify(replacementStatus), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const staleRead = clickUpOAuthAuthority.getStatus();
    await Promise.resolve();
    pairingMock.mockReturnValue(replacementPairing);

    await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(replacementStatus);
    expect(loadStoredClickUpStatus()).toEqual(replacementStatus);

    releaseOld?.(new Response(JSON.stringify(STATUS), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(staleRead).rejects.toMatchObject({ code: 'grant_changed', status: 409 });

    expect(loadStoredClickUpStatus()).toEqual(replacementStatus);
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

  it('keeps an ambiguous personal-token activation unknown until its settle barrier expires', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-22T18:00:00.000Z'));
      const replacement = {
        ...STATUS,
        account: { id: '456', username: 'Replacement', email: 'replacement@example.com' },
        workspaces: [{ id: '1000', name: 'Replacement Workspace' }],
        updatedAt: 234567,
      };
      let statusReads = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/clickup/oauth/personal-token')) {
          throw new TypeError('response lost after request send');
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

      await vi.advanceTimersByTimeAsync(CLICKUP_CONNECTION_SETTLE_MS + 1);
      await expect(clickUpOAuthAuthority.getStatus()).resolves.toEqual(replacement);
      expect(statusReads).toBe(1);
      expect(loadStoredClickUpStatus()).toEqual(replacement);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an ambiguous OAuth exchange unknown until its settle barrier expires', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-22T18:00:00.000Z'));
      let statusReads = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/clickup/oauth/exchange')) {
          throw new TypeError('response lost after request send');
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

      await vi.advanceTimersByTimeAsync(CLICKUP_CONNECTION_SETTLE_MS + 1);
      await expect(clickUpOAuthAuthority.getExecutionGrant()).resolves.toEqual(expect.objectContaining({
        status: STATUS,
        revision: STATUS.updatedAt,
      }));
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
