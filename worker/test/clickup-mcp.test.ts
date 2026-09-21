import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, reset } from 'cloudflare:test';
import {
  CLICKUP_MCP_PATH,
  CLICKUP_MCP_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
} from '../../src/clickup/mcp-protocol';
import { CLICKUP_TOOL_NAMES } from '../../src/clickup/tool-schema';
import { TOKEN } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';

function meta() {
  return {
    [MCP_META_PROTOCOL_VERSION]: CLICKUP_MCP_PROTOCOL_VERSION,
    [MCP_META_CLIENT_CAPABILITIES]: {},
    [MCP_META_CLIENT_INFO]: { name: 'worker-test', version: '1.0.0' },
  };
}

function request(method: string, params: Record<string, unknown>, name?: string, overrides: HeadersInit = {}) {
  return SELF.fetch(`https://worker.example${CLICKUP_MCP_PATH}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': CLICKUP_MCP_PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(name ? { 'Mcp-Name': name } : {}),
      ...Object.fromEntries(new Headers(overrides)),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rpc-1',
      method,
      params: { ...params, _meta: meta() },
    }),
  });
}

describe('ClickUp MCP Worker boundary', () => {
  beforeEach(async () => {
    await reset();
  });

  it('advertises the modern MCP CORS/header surface only to the allowed origin', async () => {
    const response = await SELF.fetch(`https://worker.example${CLICKUP_MCP_PATH}`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const allowed = response.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowed).toContain('Authorization');
    expect(allowed).toContain('MCP-Protocol-Version');
    expect(allowed).toContain('Mcp-Method');
    expect(allowed).toContain('Mcp-Name');
  });

  it('rejects an untrusted browser origin before parsing JSON-RPC', async () => {
    const response = await SELF.fetch(`https://worker.example${CLICKUP_MCP_PATH}`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('requires the installation bearer even for server discovery', async () => {
    const response = await SELF.fetch(`https://worker.example${CLICKUP_MCP_PATH}`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': CLICKUP_MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'server/discover',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'rpc-1',
        method: 'server/discover',
        params: { _meta: meta() },
      }),
    });
    expect(response.status).toBe(401);
  });

  it('implements stateless server/discover with current protocol identity and cache hints', async () => {
    const response = await request('server/discover', {});
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.result).toEqual(expect.objectContaining({
      resultType: 'complete',
      supportedVersions: [CLICKUP_MCP_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      ttlMs: 60_000,
      cacheScope: 'private',
    }));
    expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'elara-clickup',
      version: '0.1.0',
    });
  });

  it('publishes the canonical ClickUp schema surface through tools/list', async () => {
    const response = await request('tools/list', {});
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual([...CLICKUP_TOOL_NAMES]);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('rejects header/body routing disagreement before dispatch', async () => {
    const response = await request('tools/list', {}, undefined, { 'Mcp-Method': 'server/discover' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: -32020 }),
    }));
  });

  it('rejects an unsupported protocol revision before dispatch', async () => {
    const response = await request('tools/list', {}, undefined, { 'MCP-Protocol-Version': '2025-11-25' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: -32022 }),
    }));
  });

  it('returns provider authorization failure as a complete tool error rather than JSON-RPC transport failure', async () => {
    const response = await request('tools/call', {
      name: 'clickup.getTask',
      arguments: { taskId: '86task' },
    }, 'clickup.getTask');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.result).toEqual(expect.objectContaining({
      resultType: 'complete',
      isError: true,
      structuredContent: expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'authorization_required', status: 401 }),
      }),
    }));
  });

  it('keeps attachArtifact fail-closed until authenticated staging exists', async () => {
    const response = await request('tools/call', {
      name: 'clickup.attachArtifact',
      arguments: { taskId: '86task', artifactId: 'artifact-1' },
    }, 'clickup.attachArtifact');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe('attachment_staging_required');
  });
});
