import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../autonomy/cloud/pairing', () => ({
  loadPairing: vi.fn(),
  resolvePairingToken: vi.fn(),
}));

import { loadPairing, resolvePairingToken } from '../autonomy/cloud/pairing';
import {
  callClickUpMcpTool,
  listClickUpMcpTools,
  resetClickUpMcpClientForTests,
} from './mcp-client';
import {
  CLICKUP_MCP_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
} from './mcp-protocol';
import { clickUpMcpToolDefinitions } from './tool-schema';

const pairingMock = vi.mocked(loadPairing);
const tokenMock = vi.mocked(resolvePairingToken);

const PAIRING = {
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

function rpc(id: string, result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function resultId(body: BodyInit | null | undefined): string {
  return (JSON.parse(String(body)) as { id: string }).id;
}

function discover(id: string) {
  return rpc(id, {
    resultType: 'complete',
    supportedVersions: [CLICKUP_MCP_PROTOCOL_VERSION],
    capabilities: { tools: {} },
    ttlMs: 60_000,
    cacheScope: 'private',
  });
}

describe('ClickUp MCP browser client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetClickUpMcpClientForTests();
    pairingMock.mockReturnValue(PAIRING);
    tokenMock.mockResolvedValue('installation-token');
  });

  it('sends the modern stateless envelope and caches canonical tools/list within the advertised TTL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init: init ?? {} });
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(url).toBe('https://worker.example/mcp/clickup');
      expect(headers.get('Authorization')).toBe('Bearer installation-token');
      expect(headers.get('Accept')).toBe('application/json, text/event-stream');
      expect(headers.get('MCP-Protocol-Version')).toBe(CLICKUP_MCP_PROTOCOL_VERSION);
      expect(body.params._meta[MCP_META_PROTOCOL_VERSION]).toBe(CLICKUP_MCP_PROTOCOL_VERSION);
      expect(body.params._meta[MCP_META_CLIENT_CAPABILITIES]).toEqual({});
      expect(body.params._meta[MCP_META_CLIENT_INFO]).toEqual({ name: 'elara-angelic', version: '0.1.0' });

      if (body.method === 'server/discover') {
        expect(headers.get('Mcp-Method')).toBe('server/discover');
        expect(headers.get('Mcp-Name')).toBeNull();
        return discover(body.id);
      }
      expect(body.method).toBe('tools/list');
      expect(headers.get('Mcp-Method')).toBe('tools/list');
      expect(headers.get('Mcp-Name')).toBeNull();
      return rpc(body.id, {
        resultType: 'complete',
        tools: clickUpMcpToolDefinitions,
        ttlMs: 60_000,
        cacheScope: 'private',
      });
    }) as unknown as typeof fetch;

    const first = await listClickUpMcpTools();
    const second = await listClickUpMcpTools();
    expect(first).toEqual(clickUpMcpToolDefinitions);
    expect(second).toBe(first);
    expect(calls).toHaveLength(2);
  });

  it('rejects invalid semantic arguments before any Worker request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(callClickUpMcpTool('clickup.getTask', { taskId: '' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supports Streamable HTTP SSE tool results and mirrors Mcp-Name', async () => {
    let discovered = false;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      const headers = new Headers(init?.headers);
      if (!discovered) {
        discovered = true;
        return discover(body.id);
      }
      expect(body.method).toBe('tools/call');
      expect(headers.get('Mcp-Method')).toBe('tools/call');
      expect(headers.get('Mcp-Name')).toBe('clickup.getTask');
      const frame = JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resultType: 'complete',
          isError: false,
          content: [{ type: 'text', text: '{"id":"86task"}' }],
          structuredContent: { trust: 'untrusted-external', provider: 'clickup', id: '86task', name: 'Repair S56' },
        },
      });
      return new Response(`event: message\ndata: ${frame}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    await expect(callClickUpMcpTool('clickup.getTask', { taskId: '86task' })).resolves.toEqual({
      trust: 'untrusted-external',
      provider: 'clickup',
      id: '86task',
      name: 'Repair S56',
    });
  });

  it('rejects tools/list schema drift from a stale or compromised Worker', async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      if (body.method === 'server/discover') return discover(body.id);
      const drifted = clickUpMcpToolDefinitions.map((tool, index) => index === 0
        ? { ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } }
        : tool);
      return rpc(body.id, {
        resultType: 'complete',
        tools: drifted,
        ttlMs: 60_000,
        cacheScope: 'private',
      });
    }) as unknown as typeof fetch;

    await expect(listClickUpMcpTools()).rejects.toThrow(/schema drifted/i);
  });

  it('surfaces complete MCP tool errors without losing provider error identity', async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      if (body.method === 'server/discover') return discover(body.id);
      return rpc(body.id, {
        resultType: 'complete',
        isError: true,
        content: [{ type: 'text', text: 'rate limited' }],
        structuredContent: {
          ok: false,
          error: { code: 'rate_limited', message: 'ClickUp request budget is exhausted.', status: 429, retryAt: 1234 },
        },
      });
    }) as unknown as typeof fetch;

    await expect(callClickUpMcpTool('clickup.getTask', { taskId: '86task' })).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  });
});
