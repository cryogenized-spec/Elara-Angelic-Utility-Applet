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
  type ClickUpAdmittedGrant,
} from './mcp-client';
import {
  CLICKUP_GRANT_REVISION_HEADER,
  CLICKUP_TOOL_CATALOG_HEADER,
  CLICKUP_MCP_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
} from './mcp-protocol';
import { clickUpMcpToolDefinitions, clickUpToolCatalogFingerprint } from './tool-schema';

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

const ADMITTED: ClickUpAdmittedGrant = {
  revision: 123,
  authorityBinding: 'https://worker.example#test-installation',
};

type RpcRequestBody = {
  readonly id: string;
  readonly method: string;
  readonly params: {
    readonly _meta: Record<string, unknown>;
    readonly [key: string]: unknown;
  };
};

function requestBody(init?: RequestInit): RpcRequestBody {
  const parsed = JSON.parse(String(init?.body)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid test JSON-RPC request.');
  const record = parsed as Record<string, unknown>;
  const params = record.params;
  if (typeof record.id !== 'string' || typeof record.method !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Invalid test JSON-RPC request shape.');
  }
  const meta = (params as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Missing test JSON-RPC metadata.');
  return {
    id: record.id,
    method: record.method,
    params: { ...(params as Record<string, unknown>), _meta: meta as Record<string, unknown> },
  };
}

function rpc(id: string, result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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

function toolsList(id: string, tools = clickUpMcpToolDefinitions) {
  return rpc(id, {
    resultType: 'complete',
    tools,
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
      const body = requestBody(init);
      expect(url).toBe('https://worker.example/mcp/clickup');
      expect(headers.get('Authorization')).toBe('Bearer installation-token');
      expect(headers.get('Accept')).toBe('application/json, text/event-stream');
      expect(headers.get('MCP-Protocol-Version')).toBe(CLICKUP_MCP_PROTOCOL_VERSION);
      const meta = body.params._meta;
      expect(meta[MCP_META_PROTOCOL_VERSION]).toBe(CLICKUP_MCP_PROTOCOL_VERSION);
      expect(meta[MCP_META_CLIENT_CAPABILITIES]).toEqual({});
      expect(meta[MCP_META_CLIENT_INFO]).toEqual({ name: 'elara-angelic', version: '0.1.0' });

      if (body.method === 'server/discover') {
        expect(headers.get('Mcp-Method')).toBe('server/discover');
        expect(headers.get('Mcp-Name')).toBeNull();
        return discover(body.id);
      }
      expect(body.method).toBe('tools/list');
      expect(headers.get('Mcp-Method')).toBe('tools/list');
      expect(headers.get('Mcp-Name')).toBeNull();
      return toolsList(body.id);
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
    await expect(callClickUpMcpTool('clickup.getTask', { workspaceId: '999', taskId: '' }, undefined, ADMITTED)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an admitted provider grant before tool execution', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(callClickUpMcpTool('clickup.getTask', { workspaceId: '999', taskId: '86task' })).rejects.toMatchObject({
      code: 'grant_required',
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supports Streamable HTTP SSE tool results after validating tools/list on the same Worker', async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init);
      const headers = new Headers(init?.headers);
      methods.push(body.method);

      if (body.method === 'server/discover') return discover(body.id);
      if (body.method === 'tools/list') return toolsList(body.id);

      expect(body.method).toBe('tools/call');
      expect(headers.get('Mcp-Method')).toBe('tools/call');
      expect(headers.get('Mcp-Name')).toBe('clickup.getTask');
      expect(headers.get(CLICKUP_GRANT_REVISION_HEADER)).toBe('123');
      expect(headers.get(CLICKUP_TOOL_CATALOG_HEADER)).toBe(await clickUpToolCatalogFingerprint());
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

    await expect(callClickUpMcpTool(
      'clickup.getTask',
      { workspaceId: '999', taskId: '86task' },
      undefined,
      ADMITTED,
    )).resolves.toEqual({
      trust: 'untrusted-external',
      provider: 'clickup',
      id: '86task',
      name: 'Repair S56',
    });
    expect(methods).toEqual(['server/discover', 'tools/list', 'tools/call']);
  });

  it('rejects tools/list schema drift from a stale or compromised Worker', async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init);
      if (body.method === 'server/discover') return discover(body.id);
      const drifted = clickUpMcpToolDefinitions.map((tool, index) => index === 0
        ? { ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } }
        : tool);
      return toolsList(body.id, drifted);
    }) as unknown as typeof fetch;

    await expect(listClickUpMcpTools()).rejects.toThrow(/schema drifted/i);
  });

  it('blocks tools/call when the Worker catalog drifts after protocol discovery', async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init);
      methods.push(body.method);
      if (body.method === 'server/discover') return discover(body.id);
      if (body.method === 'tools/list') {
        const drifted = clickUpMcpToolDefinitions.map((tool, index) => index === 0
          ? { ...tool, description: `${tool.description} stale` }
          : tool);
        return toolsList(body.id, drifted);
      }
      throw new Error('tools/call must not execute against a drifted Worker catalog.');
    }) as unknown as typeof fetch;

    await expect(callClickUpMcpTool(
      'clickup.getTask',
      { workspaceId: '999', taskId: '86task' },
      undefined,
      ADMITTED,
    )).rejects.toThrow(/description drifted/i);
    expect(methods).toEqual(['server/discover', 'tools/list']);
  });

  it('fails closed if the paired Worker changes after grant admission', async () => {
    pairingMock.mockReturnValue({ ...PAIRING, workerUrl: 'https://replacement.example' });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(callClickUpMcpTool(
      'clickup.getTask',
      { workspaceId: '999', taskId: '86task' },
      undefined,
      ADMITTED,
    )).rejects.toMatchObject({ code: 'grant_changed', status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces complete MCP tool errors without losing provider error identity', async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init);
      if (body.method === 'server/discover') return discover(body.id);
      if (body.method === 'tools/list') return toolsList(body.id);
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

    await expect(callClickUpMcpTool(
      'clickup.getTask',
      { workspaceId: '999', taskId: '86task' },
      undefined,
      ADMITTED,
    )).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  });
});
