import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  CLICKUP_GRANT_REVISION_HEADER,
  CLICKUP_TOOL_CATALOG_HEADER,
  CLICKUP_MCP_PATH,
  CLICKUP_MCP_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
} from '../../src/clickup/mcp-protocol';
import { CLICKUP_TOOL_NAMES, clickUpToolCatalogFingerprint } from '../../src/clickup/tool-schema';
import { resetClickUpTestState, signedWrite, TOKEN } from './helpers';
import { boundedClickUpMcpResult } from '../src/clickup/mcp-route';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;

async function connectClickUp(): Promise<number> {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await SELF.fetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };
  const exchangeBody = JSON.stringify({ code: 'one-time-code', state, redirectUri: REDIRECT_URI });
  const exchanged = await SELF.fetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  expect(exchanged.status).toBe(200);
  const status = await exchanged.json() as { updatedAt?: number };
  expect(status.updatedAt).toBeGreaterThan(0);
  return status.updatedAt ?? 0;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object response.');
  return value as Record<string, unknown>;
}

async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  return record(await response.json() as unknown);
}

function meta() {
  return {
    [MCP_META_PROTOCOL_VERSION]: CLICKUP_MCP_PROTOCOL_VERSION,
    [MCP_META_CLIENT_CAPABILITIES]: {},
    [MCP_META_CLIENT_INFO]: { name: 'worker-test', version: '1.0.0' },
  };
}

async function request(method: string, params: Record<string, unknown>, name?: string, overrides: HeadersInit = {}) {
  const headers = new Headers({
    Origin: ORIGIN,
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': CLICKUP_MCP_PROTOCOL_VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    ...(method === 'tools/call' ? {
      [CLICKUP_GRANT_REVISION_HEADER]: '1',
      [CLICKUP_TOOL_CATALOG_HEADER]: await clickUpToolCatalogFingerprint(),
    } : {}),
  });
  for (const [key, value] of new Headers(overrides)) headers.set(key, value);
  return SELF.fetch(`https://worker.example${CLICKUP_MCP_PATH}`, {
    method: 'POST',
    headers,
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
    vi.restoreAllMocks();
    await resetClickUpTestState();
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
    expect(allowed).toContain(CLICKUP_GRANT_REVISION_HEADER);
    expect(allowed).toContain(CLICKUP_TOOL_CATALOG_HEADER);
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
    const body = await jsonRecord(response);
    const result = record(body.result);
    expect(result).toEqual(expect.objectContaining({
      resultType: 'complete',
      supportedVersions: [CLICKUP_MCP_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      ttlMs: 60_000,
      cacheScope: 'private',
    }));
    expect(record(result._meta)['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'elara-clickup',
      version: '0.1.0',
    });
  });

  it('publishes the canonical ClickUp schema surface through tools/list', async () => {
    const response = await request('tools/list', {});
    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(body.result);
    const rawTools: unknown[] = Array.isArray(result.tools) ? result.tools as unknown[] : [];
    const tools = rawTools.map(record);
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([...CLICKUP_TOOL_NAMES]);
    for (const tool of tools) {
      const inputSchema = record(tool.inputSchema);
      expect(inputSchema.type).toBe('object');
      expect(inputSchema.additionalProperties).toBe(false);
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
  it('rejects tools/call without the admitted provider grant revision', async () => {
    const response = await request('tools/call', {
      name: 'clickup.getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, 'clickup.getTask', { [CLICKUP_GRANT_REVISION_HEADER]: '' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: -32023 }),
    }));
  });


  it('rejects tools/call when the browser catalog fingerprint is missing or stale', async () => {
    for (const supplied of ['', '0'.repeat(64)]) {
      const response = await request('tools/call', {
        name: 'clickup.getTask',
        arguments: { workspaceId: '999', taskId: '86task' },
      }, 'clickup.getTask', { [CLICKUP_TOOL_CATALOG_HEADER]: supplied });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        error: expect.objectContaining({ code: -32024 }),
      }));
    }
  });

  it('returns provider authorization failure as a complete tool error rather than JSON-RPC transport failure', async () => {
    const response = await request('tools/call', {
      name: 'clickup.getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, 'clickup.getTask');
    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    expect(record(body.result)).toEqual(expect.objectContaining({
      resultType: 'complete',
      isError: true,
      structuredContent: expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'authorization_required', status: 401 }),
      }),
    }));
  });

  it('fails resolveAssignees closed for an ungranted Workspace instead of fabricating no matches', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);
      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'assignee-scope-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({
          teams: [{
            id: '999',
            name: 'Workspace A',
            members: [{ user: { id: 183, username: 'Gareth', email: 'gareth@example.com' } }],
          }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-a', secret: 'webhook-secret' } }), { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const response = await request('tools/call', {
      name: 'clickup.resolveAssignees',
      arguments: { workspaceId: '998', names: ['Gareth'] },
    }, 'clickup.resolveAssignees', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(body.result);
    expect(result.isError).toBe(true);
    const error = record(record(result.structuredContent).error);
    expect(error).toEqual(expect.objectContaining({
      code: 'workspace_forbidden',
      status: 403,
    }));
  });

  it('blocks cross-Workspace direct ids and never bleeds rejected provider content into MCP results', async () => {
    const secret = 'WORKSPACE_B_SECRET_SHOULD_NEVER_REACH_GEMINI';
    let forbiddenDownstreamCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'cross-scope-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        // Elara admits only Workspace A. The provider token intentionally still
        // resolves B resources below to model stale/wider provider authority.
        return new Response(JSON.stringify({
          teams: [{ id: '999', name: 'Workspace A', members: [] }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-a', secret: 'webhook-secret' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/space' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          spaces: [{ id: '111', name: 'A Space' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/task-b' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'task-b',
          name: secret,
          markdown_description: secret,
          team_id: '998',
          list: { id: '333', name: secret },
          folder: { id: '444', name: secret },
          space: { id: '222', name: secret },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/folder/444' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: '444',
          name: secret,
          space: { id: '222', name: secret },
          lists: [{ id: '333', name: secret }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/list/333' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: '333',
          name: secret,
          space: { id: '222', name: secret },
          folder: { id: '444', name: secret },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (
        url.pathname.startsWith('/api/v2/task/task-b/comment')
        || url.pathname.startsWith('/api/v2/task/task-b/field/')
        || url.pathname === '/api/v2/task/task-b'
        || url.pathname === '/api/v2/list/333/task'
        || url.pathname.startsWith('/api/v2/space/222/')
      ) {
        forbiddenDownstreamCalls += 1;
        throw new Error(`Cross-Workspace downstream call escaped scope verification: ${providerRequest.method} ${providerRequest.url}`);
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const attempts: Array<{ name: typeof CLICKUP_TOOL_NAMES[number]; arguments: Record<string, unknown> }> = [
      { name: 'clickup.getTask', arguments: { workspaceId: '999', taskId: 'task-b' } },
      { name: 'clickup.getTaskContext', arguments: { workspaceId: '999', taskId: 'task-b', commentsLimit: 10 } },
      { name: 'clickup.getTaskComments', arguments: { workspaceId: '999', taskId: 'task-b' } },
      { name: 'clickup.listHierarchy', arguments: { workspaceId: '999', spaceId: '222' } },
      { name: 'clickup.listHierarchy', arguments: { workspaceId: '999', folderId: '444' } },
      { name: 'clickup.createTask', arguments: { workspaceId: '999', listId: '333', name: 'Do not create' } },
      { name: 'clickup.updateTask', arguments: { workspaceId: '999', taskId: 'task-b', status: 'complete' } },
      { name: 'clickup.createTaskComment', arguments: { workspaceId: '999', taskId: 'task-b', text: 'Do not post' } },
      { name: 'clickup.setCustomField', arguments: { workspaceId: '999', taskId: 'task-b', fieldId: 'field-b', value: 'Do not set' } },
    ];

    for (const attempt of attempts) {
      const response = await request('tools/call', {
        name: attempt.name,
        arguments: attempt.arguments,
      }, attempt.name, {
        [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
      });

      expect(response.status, attempt.name).toBe(200);
      const body = await jsonRecord(response);
      const result = record(body.result);
      expect(result.isError, attempt.name).toBe(true);
      const structured = record(result.structuredContent);
      const error = record(structured.error);
      expect(error.code, attempt.name).toBe('resource_workspace_mismatch');
      expect(JSON.stringify(body), attempt.name).not.toContain(secret);
    }

    expect(forbiddenDownstreamCalls).toBe(0);
  });

  it('authenticates comment cursors and rejects cross-task cursor transplantation before provider egress', async () => {
    let commentCalls = 0;
    let otherTaskReads = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const providerHeaders = {
      'content-type': 'application/json',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '90',
      'X-RateLimit-Reset': String(resetAt),
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'cursor-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'cursor-webhook', secret: 'cursor-secret' } }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/webhook/cursor-webhook' && providerRequest.method === 'DELETE') {
        return new Response(JSON.stringify({}), { status: 200, headers: providerHeaders });
      }
      if (url.pathname === '/api/v2/task/task-a' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'task-a',
          name: 'Task A',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: providerHeaders });
      }
      if (url.pathname === '/api/v2/task/task-b' && providerRequest.method === 'GET') {
        otherTaskReads += 1;
        return new Response(JSON.stringify({
          id: 'task-b',
          name: 'Task B',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: providerHeaders });
      }
      if (url.pathname === '/api/v2/task/task-a/comment' && providerRequest.method === 'GET') {
        commentCalls += 1;
        const comments = Array.from({ length: 25 }, (_, index) => ({
          id: String(1000 + index),
          comment_text: `Comment ${index}`,
          date: 1_790_000_000_000 + index,
        }));
        return new Response(JSON.stringify({ comments }), { status: 200, headers: providerHeaders });
      }
      if (url.pathname === '/api/v2/task/task-b/comment' && providerRequest.method === 'GET') {
        commentCalls += 1;
        throw new Error('A cursor issued for task-a must never reach task-b comments.');
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const first = await request('tools/call', {
      name: 'clickup.getTaskComments',
      arguments: { workspaceId: '999', taskId: 'task-a', limit: 25 },
    }, 'clickup.getTaskComments', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });
    expect(first.status).toBe(200);
    const firstBody = await jsonRecord(first);
    const firstResult = record(record(firstBody.result).structuredContent);
    expect(typeof firstResult.nextCursor).toBe('string');
    const cursor = String(firstResult.nextCursor);
    expect(cursor).toContain('.');
    expect(commentCalls).toBe(1);

    const transplanted = await request('tools/call', {
      name: 'clickup.getTaskComments',
      arguments: { workspaceId: '999', taskId: 'task-b', cursor, limit: 25 },
    }, 'clickup.getTaskComments', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });
    expect(transplanted.status).toBe(200);
    const transplantedBody = await jsonRecord(transplanted);
    const transplantedResult = record(transplantedBody.result);
    expect(transplantedResult.isError).toBe(true);
    expect(record(record(transplantedResult.structuredContent).error)).toEqual(expect.objectContaining({
      code: 'validation',
      status: 400,
    }));
    expect(commentCalls).toBe(1);
    expect(otherTaskReads).toBe(0);

    const replacementRevision = await connectClickUp();
    expect(replacementRevision).toBeGreaterThan(revision);
    const staleGrantCursor = await request('tools/call', {
      name: 'clickup.getTaskComments',
      arguments: { workspaceId: '999', taskId: 'task-a', cursor, limit: 25 },
    }, 'clickup.getTaskComments', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(replacementRevision),
    });
    expect(staleGrantCursor.status).toBe(200);
    const staleBody = await jsonRecord(staleGrantCursor);
    const staleResult = record(staleBody.result);
    expect(staleResult.isError).toBe(true);
    expect(record(record(staleResult.structuredContent).error)).toEqual(expect.objectContaining({
      code: 'validation',
      status: 400,
    }));
    expect(commentCalls).toBe(1);
  });

  it('caps malformed comment-page amplification and returns a continuation cursor', async () => {
    let commentCalls = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const providerHeaders = {
      'content-type': 'application/json',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '90',
      'X-RateLimit-Reset': String(resetAt),
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'pagination-bound-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'pagination-webhook', secret: 'pagination-secret' } }), {
          status: 200,
          headers: providerHeaders,
        });
      }
      if (url.pathname === '/api/v2/task/task-a' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'task-a',
          name: 'Task A',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: providerHeaders });
      }
      if (url.pathname === '/api/v2/task/task-a/comment' && providerRequest.method === 'GET') {
        commentCalls += 1;
        const comments = Array.from({ length: 25 }, (_, index) => (
          index === 0
            ? {
                id: String(2000 + commentCalls),
                comment_text: `Valid comment ${commentCalls}`,
                date: 1_790_000_000_000 + commentCalls,
              }
            : { comment_text: 'malformed provider row without an id' }
        ));
        return new Response(JSON.stringify({ comments }), { status: 200, headers: providerHeaders });
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const response = await request('tools/call', {
      name: 'clickup.getTaskComments',
      arguments: { workspaceId: '999', taskId: 'task-a', limit: 50 },
    }, 'clickup.getTaskComments', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(record(body.result).structuredContent);
    expect(result.comments).toHaveLength(4);
    expect(typeof result.nextCursor).toBe('string');
    expect(String(result.nextCursor)).toContain('.');
    expect(commentCalls).toBe(4);
  });

  it('rejects subtask creation when the approved parent belongs to a different List', async () => {
    let createCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'clickup-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-1', secret: 'webhook-secret' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/list/123' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: '123',
          name: 'Target List',
          space: { id: '789' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/team/999/space' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          spaces: [{ id: '789', name: 'Workspace A Space' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/parent-task' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'parent-task',
          name: 'Parent in another List',
          team_id: '999',
          list: { id: '456', name: 'Different List' },
          space: { id: '789' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/list/123/task' && providerRequest.method === 'POST') {
        createCalls += 1;
        return new Response(JSON.stringify({ id: 'must-not-create' }), { status: 200 });
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const response = await request('tools/call', {
      name: 'clickup.createTask',
      arguments: {
        workspaceId: '999',
        listId: '123',
        name: 'Invalid cross-List subtask',
        parentTaskId: 'parent-task',
      },
    }, 'clickup.createTask', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(body.result);
    expect(result.isError).toBe(true);
    expect(record(record(result.structuredContent).error)).toEqual(expect.objectContaining({
      code: 'parent_list_mismatch',
      status: 400,
    }));
    expect(createCalls).toBe(0);
  });

  it('rejects a List-visible Custom Field that is not applicable to the task custom type', async () => {
    let customFieldMutations = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'clickup-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-1', secret: 'webhook-secret' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/task/86task' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          custom_item_id: 7,
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/list/123/field' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          fields: [{
            id: 'field_1',
            name: 'Different task type only',
            type: 'short_text',
            applied_objects: [{ object_type: 19, object_id: 8 }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/86task/field/field_1') {
        customFieldMutations += 1;
        return new Response(JSON.stringify({ id: 'must-not-write' }), { status: 200 });
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const response = await request('tools/call', {
      name: 'clickup.setCustomField',
      arguments: {
        workspaceId: '999',
        taskId: '86task',
        fieldId: 'field_1',
        mode: 'set',
        value: 'Ready',
      },
    }, 'clickup.setCustomField', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(body.result);
    expect(result.isError).toBe(true);
    expect(record(record(result.structuredContent).error)).toEqual(expect.objectContaining({
      code: 'custom_field_not_applicable',
      status: 400,
    }));
    expect(customFieldMutations).toBe(0);
  });

  it.each([
    ['set', { workspaceId: '999', taskId: '86task', fieldId: 'field_1', mode: 'set' as const, value: 'Ready' }, 'POST'],
    ['clear', { workspaceId: '999', taskId: '86task', fieldId: 'field_1', mode: 'clear' as const }, 'DELETE'],
  ])('carries the admitted grant revision through Custom Field %s execution', async (_mode, argumentsValue, mutationMethod) => {
    let customFieldMutations = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'clickup-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && providerRequest.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-1', secret: 'webhook-secret' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/task/86task' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/list/123/field' && providerRequest.method === 'GET') {
        return new Response(JSON.stringify({
          fields: [{ id: 'field_1', name: 'Repair state', type: 'short_text' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/86task/field/field_1' && providerRequest.method === mutationMethod) {
        customFieldMutations += 1;
        return new Response(JSON.stringify({ id: 'hist-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unexpected provider request: ${providerRequest.method} ${providerRequest.url}`);
    });

    const revision = await connectClickUp();
    const response = await request('tools/call', {
      name: 'clickup.setCustomField',
      arguments: argumentsValue,
    }, 'clickup.setCustomField', {
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    expect(record(body.result)).toEqual(expect.objectContaining({
      resultType: 'complete',
      isError: false,
    }));
    expect(customFieldMutations).toBe(1);
  });

  it('rejects aggregate structured MCP results above the Worker ceiling before transport', () => {
    expect(() => boundedClickUpMcpResult({
      trust: 'untrusted-external',
      provider: 'clickup',
      tasks: [{ description: 'x'.repeat(950 * 1024) }],
    })).toThrowError(expect.objectContaining({ code: 'result_too_large', status: 502 }));
  });

  it('keeps attachArtifact fail-closed until authenticated staging exists', async () => {
    const response = await request('tools/call', {
      name: 'clickup.attachArtifact',
      arguments: { workspaceId: '999', taskId: '86task', artifactId: 'artifact-1' },
    }, 'clickup.attachArtifact');
    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const result = record(body.result);
    expect(result.isError).toBe(true);
    expect(record(record(result.structuredContent).error).code).toBe('attachment_staging_required');
  });
});
