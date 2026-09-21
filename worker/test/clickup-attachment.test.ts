import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, resetClickUpTestState, signedWrite } from './helpers';
import { readClickUpAttachmentBytes } from '../src/clickup/attachment-route';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetClickUpTestState();
});

async function connect(): Promise<number> {
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

describe('ClickUp artifact attachment boundary', () => {
  it('streams an approved local artifact through the Worker and vault without exposing provider credentials', async () => {
    let attachmentCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'clickup-provider-token-secret' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }
      if (url.pathname === '/api/v2/task/86task' && request.method === 'GET') {
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '97',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }
      if (url.pathname === '/api/v2/task/86task/attachment' && request.method === 'POST') {
        attachmentCalls += 1;
        expect(request.headers.get('Authorization')).toBe('Bearer clickup-provider-token-secret');
        const form = await request.formData();
        expect(form.get('attachment[0]')).toBeInstanceOf(File);
        const file = form.get('attachment[0]') as File;
        expect(file.name).toBe('repair-note.txt');
        expect(file.type).toBe('text/plain');
        expect(await file.text()).toBe('inspection complete');
        return new Response(JSON.stringify({ id: 77, title: 'repair-note.txt' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '97',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const grantRevision = await connect();

    const form = new FormData();
    form.set('workspaceId', '999');
    form.set('taskId', '86task');
    form.set('artifactId', 'artifact-local-1');
    form.set('filename', 'repair-note.txt');
    form.set('file', new Blob(['inspection complete'], { type: 'text/plain' }), 'repair-note.txt');

    const response = await SELF.fetch('https://worker.example/clickup/attachment', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${TOKEN}`,
        [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
        Accept: 'application/json',
      },
      body: form,
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      result: {
        provider: 'clickup',
        workspaceId: '999',
        taskId: '86task',
        artifactId: 'artifact-local-1',
        filename: 'repair-note.txt',
        size: 19,
        attachmentId: '77',
        providerTitle: 'repair-note.txt',
      },
    });
    expect(JSON.stringify(body)).not.toContain('clickup-provider-token-secret');
    expect(attachmentCalls).toBe(1);
  });

  it('rejects a disallowed browser origin before the attachment reaches the vault', async () => {
    const form = new FormData();
    form.set('workspaceId', '999');
    form.set('taskId', '86task');
    form.set('artifactId', 'artifact-local-1');
    form.set('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');

    const response = await SELF.fetch('https://worker.example/clickup/attachment', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Authorization: `Bearer ${TOKEN}`, [CLICKUP_GRANT_REVISION_HEADER]: '1' },
      body: form,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('counts attachment request bytes even when Content-Length is absent', async () => {
    const request = new Request('https://worker.example/clickup/attachment', {
      method: 'POST',
      body: new Blob(['0123456789abcdef'], { type: 'application/octet-stream' }),
    });
    expect(request.headers.get('Content-Length')).toBeNull();
    await expect(readClickUpAttachmentBytes(request, 8)).rejects.toThrow('too-large');
  });

  it('requires the installation bearer before accepting multipart bytes', async () => {
    const form = new FormData();
    form.set('workspaceId', '999');
    form.set('taskId', '86task');
    form.set('artifactId', 'artifact-local-1');
    form.set('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');

    const response = await SELF.fetch('https://worker.example/clickup/attachment', {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: form,
    });
    expect(response.status).toBe(401);
  });

  it('keeps the provider mutation unreachable through malformed metadata', async () => {
    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/webhook' && request.method === 'POST') {
        return new Response(JSON.stringify({ webhook: { id: 'webhook-1', secret: 'webhook-secret' } }), { status: 200 });
      }
      providerCalls += 1;
      throw new Error('Provider should not receive malformed attachment metadata.');
    });
    const grantRevision = await connect();

    const form = new FormData();
    form.set('workspaceId', '999');
    form.set('taskId', '');
    form.set('artifactId', 'artifact-local-1');
    form.set('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');

    const response = await SELF.fetch('https://worker.example/clickup/attachment', {
      method: 'POST',
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision) },
      body: form,
    });
    expect(response.status).toBe(400);
    expect(providerCalls).toBe(0);
  });
});
