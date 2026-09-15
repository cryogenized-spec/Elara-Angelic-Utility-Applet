import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTONOMY_SCHEMA_VERSION, AutonomyCloudError, pairWithWorker } from './client';

const fetchMock = vi.fn<typeof fetch>();

function pairResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    installationId: 'a'.repeat(32),
    service: 'elara-autonomy',
    version: '1.0.0',
    schemaVersion: AUTONOMY_SCHEMA_VERSION,
    capabilities: [],
    cron: '0 * * * *',
    dryRun: false,
    ...overrides,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomy cloud pairing egress boundary', () => {
  it.each([
    ['non-HTTPS', 'http://worker.example.test'],
    ['embedded credentials', 'https://user:pass@worker.example.test'],
    ['query string', 'https://worker.example.test/?debug=1'],
    ['fragment', 'https://worker.example.test/#debug'],
  ])('rejects %s worker URLs before network access', async (_label, workerUrl) => {
    await expect(pairWithWorker(workerUrl, 'installation-token')).rejects.toMatchObject({ code: 'worker-url', status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty installation credential before network access', async () => {
    await expect(pairWithWorker('https://worker.example.test', '   ')).rejects.toMatchObject({ code: 'credential', status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the worker base URL and sends the credential only in Authorization', async () => {
    fetchMock.mockResolvedValueOnce(pairResponse());

    const result = await pairWithWorker('https://worker.example.test/base///', '  secret-token  ');

    expect(result.schemaVersion).toBe(AUTONOMY_SCHEMA_VERSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.example.test/base/autonomy/pair');
    expect(String(url)).not.toContain('secret-token');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('rejects a worker speaking a different autonomy schema', async () => {
    fetchMock.mockResolvedValueOnce(pairResponse({ schemaVersion: AUTONOMY_SCHEMA_VERSION + 1 }));

    await expect(pairWithWorker('https://worker.example.test', 'token')).rejects.toMatchObject({ code: 'version', status: 0 });
  });

  it('normalizes structured HTTP failures without exposing the credential', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unauthorized', message: 'Pairing rejected.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(pairWithWorker('https://worker.example.test', 'secret-token')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Pairing rejected.',
      status: 401,
    });
  });

  it('normalizes network failures as autonomy cloud errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connection refused'));

    const error = await pairWithWorker('https://worker.example.test', 'token').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AutonomyCloudError);
    expect(error).toMatchObject({ code: 'network', message: 'connection refused', status: 0 });
  });
});
