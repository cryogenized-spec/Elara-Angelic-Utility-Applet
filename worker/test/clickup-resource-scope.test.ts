import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, resetClickUpTestState, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
let grantRevision = 0;

type ProviderCounters = {
  resourceReads: number;
  taskCommentsA: number;
  taskCommentsB: number;
  createTask: number;
  updateTask: number;
  createComment: number;
  replyComment: number;
  setField: number;
  clearField: number;
  attachment: number;
};

beforeEach(async () => {
  vi.restoreAllMocks();
  grantRevision = 0;
  await resetClickUpTestState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.CLICKUP_OAUTH!.get(env.CLICKUP_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  const remote = await (await stub()).fetch(request);
  const bytes = await remote.arrayBuffer();
  return new Response(bytes, {
    status: remote.status,
    statusText: remote.statusText,
    headers: remote.headers,
  });
}

async function connect(code = 'one-time-code'): Promise<void> {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await doFetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };

  const exchangeBody = JSON.stringify({ code, state, redirectUri: REDIRECT_URI });
  const exchanged = await doFetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  expect(exchanged.status).toBe(200);
  const status = await exchanged.json() as { updatedAt?: number };
  grantRevision = status.updatedAt ?? 0;
  expect(grantRevision).toBeGreaterThan(0);
}

async function internalCommand(command: unknown, revision = grantRevision): Promise<Response> {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(revision),
    },
    body: JSON.stringify(command),
  }));
}

async function internalAttachment(workspaceId: string, taskId: string): Promise<Response> {
  const form = new FormData();
  form.set('workspaceId', workspaceId);
  form.set('taskId', taskId);
  form.set('artifactId', 'artifact-redteam');
  form.set('filename', 'probe.txt');
  form.set('file', new Blob(['probe'], { type: 'text/plain' }), 'probe.txt');
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/attachment', {
    method: 'POST',
    headers: {
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
    },
    body: form,
  }));
}

function providerFixture(): ProviderCounters {
  const counters: ProviderCounters = {
    resourceReads: 0,
    taskCommentsA: 0,
    taskCommentsB: 0,
    createTask: 0,
    updateTask: 0,
    createComment: 0,
    replyComment: 0,
    setField: 0,
    clearField: 0,
    attachment: 0,
  };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === '/api/v2/oauth/token') {
      return new Response(JSON.stringify({ access_token: 'token-can-see-a-and-b' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/user') {
      return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/team') {
      // Elara locally admits only Workspace A. The underlying provider token is
      // deliberately mocked as still able to resolve resources in B.
      return new Response(JSON.stringify({
        teams: [{
          id: '111',
          name: 'Workspace A',
          members: [{ user: { id: 183, username: 'Gareth' } }],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/api/v2/team/111/space') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({
        spaces: [{ id: '1111', name: 'A Space', archived: url.searchParams.get('archived') === 'true' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/api/v2/task/task-a' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({
        id: 'task-a',
        name: 'A task',
        team_id: '111',
        list: { id: '1112', name: 'A List' },
        space: { id: '1111' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/v2/task/task-b' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({
        id: 'task-b',
        name: 'SECRET_B_TASK',
        markdown_description: 'SECRET_B_DESCRIPTION',
        team_id: '222',
        list: { id: '2221', name: 'SECRET_B_LIST' },
        space: { id: '2222' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/v2/task/missing-task' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ ECODE: 'TASK_404', err: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/task/no-ancestry' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({
        id: 'no-ancestry',
        name: 'Provider task without Workspace ancestry',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/api/v2/folder/2223' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({
        id: '2223',
        name: 'SECRET_B_FOLDER',
        space: { id: '2222' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/v2/folder/missing-folder' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ ECODE: 'FOLDER_404', err: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/api/v2/list/1112' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ id: '1112', name: 'A List', space: { id: '1111' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/list/2221' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ id: '2221', name: 'SECRET_B_LIST', space: { id: '2222' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/list/missing-list' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ ECODE: 'LIST_404', err: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/api/v2/list/1112/field' && request.method === 'GET') {
      counters.resourceReads += 1;
      return new Response(JSON.stringify({ fields: [{ id: 'field-a', name: 'A Field' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/api/v2/task/task-b/comment' && request.method === 'GET') {
      counters.taskCommentsB += 1;
      return new Response(JSON.stringify({ comments: [{ id: 991, comment_text: 'SECRET_B_COMMENT' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v2/task/task-a/comment' && request.method === 'GET') {
      counters.taskCommentsA += 1;
      return new Response(JSON.stringify({ comments: [{ id: 100, comment_text: 'A comment', date: 1_790_000_000_000 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/api/v2/list/1112/task' && request.method === 'POST') {
      counters.createTask += 1;
      return new Response(JSON.stringify({ id: 'created' }), { status: 200 });
    }
    if (url.pathname === '/api/v2/list/2221/task' && request.method === 'POST') {
      counters.createTask += 1;
      return new Response(JSON.stringify({ id: 'created-b' }), { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-b' && request.method === 'PUT') {
      counters.updateTask += 1;
      return new Response(JSON.stringify({ id: 'task-b', name: 'mutated' }), { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-a' && request.method === 'PUT') {
      counters.updateTask += 1;
      return new Response(JSON.stringify({ id: 'task-a', name: 'mutated' }), { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-a/comment' && request.method === 'POST') {
      counters.createComment += 1;
      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    }
    if (url.pathname === '/api/v2/comment/991/reply' && request.method === 'POST') {
      counters.replyComment += 1;
      return new Response(JSON.stringify({ id: 2 }), { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-a/field/field-a' && request.method === 'POST') {
      counters.setField += 1;
      return new Response('{}', { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-a/field/field-a' && request.method === 'DELETE') {
      counters.clearField += 1;
      return new Response('{}', { status: 200 });
    }
    if (url.pathname === '/api/v2/task/task-b/attachment' && request.method === 'POST') {
      counters.attachment += 1;
      return new Response(JSON.stringify({ id: 7 }), { status: 200 });
    }

    throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
  });

  return counters;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object response.');
  return value as Record<string, unknown>;
}

describe('ClickUp Workspace-scoped resource authority', () => {
  it('blocks provider-visible Workspace B task content under an A grant and does not leak existence details', async () => {
    providerFixture();
    await connect();

    const knownB = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'task-b' },
    });
    const missing = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'missing-task' },
    });

    expect(knownB.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await responseBody(knownB)).toEqual(await responseBody(missing));
    expect(JSON.stringify(await responseBody(
      await internalCommand({ operation: 'getTask', arguments: { workspaceId: '111', taskId: 'task-b' } }),
    ))).not.toContain('SECRET_B');
  });

  it('blocks provider-visible B Folder and List IDs under A with the same generic scope denial as missing IDs', async () => {
    providerFixture();
    await connect();

    for (const [knownCommand, missingCommand] of [
      [
        { operation: 'getFolder', workspaceId: '111', folderId: '2223', includeSubfolders: true },
        { operation: 'getFolder', workspaceId: '111', folderId: 'missing-folder', includeSubfolders: true },
      ],
      [
        { operation: 'getList', workspaceId: '111', listId: '2221' },
        { operation: 'getList', workspaceId: '111', listId: 'missing-list' },
      ],
    ] as const) {
      const known = await internalCommand(knownCommand);
      const missing = await internalCommand(missingCommand);
      expect(known.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(await responseBody(known)).toEqual(await responseBody(missing));
    }
  });

  it('blocks B task comments and writes before the provider mutation/comment endpoints are reached', async () => {
    const counters = providerFixture();
    await connect();

    const comments = await internalCommand({
      operation: 'getTaskComments',
      workspaceId: '111',
      taskId: 'task-b',
    });
    const update = await internalCommand({
      operation: 'updateTask',
      arguments: { workspaceId: '111', taskId: 'task-b', status: 'complete' },
    });
    const createInB = await internalCommand({
      operation: 'createTask',
      arguments: { workspaceId: '111', listId: '2221', name: 'Should not create' },
    });
    const field = await internalCommand({
      operation: 'setCustomField',
      workspaceId: '111',
      taskId: 'task-b',
      fieldId: 'field-a',
      value: 'leak',
    });
    const reply = await internalCommand({
      operation: 'replyToComment',
      arguments: {
        workspaceId: '111',
        taskId: 'task-a',
        commentId: '991',
        text: 'Should not reply',
      },
    });
    const attachment = await internalAttachment('111', 'task-b');

    for (const response of [comments, update, createInB, field, reply, attachment]) {
      expect(response.status).toBe(403);
      expect(await responseBody(response)).toEqual(expect.objectContaining({ code: 'resource_workspace_mismatch' }));
    }
    expect(counters.taskCommentsB).toBe(0);
    expect(counters.taskCommentsA).toBe(1);
    expect(counters.updateTask).toBe(0);
    expect(counters.createTask).toBe(0);
    expect(counters.setField).toBe(0);
    expect(counters.replyComment).toBe(0);
    expect(counters.attachment).toBe(0);
  });

  it.each([
    ['set', { operation: 'setCustomField', workspaceId: '111', taskId: 'task-a', fieldId: 'field-a', value: 'stale' }],
    ['clear', { operation: 'clearCustomField', workspaceId: '111', taskId: 'task-a', fieldId: 'field-a' }],
  ] as const)('rejects Custom Field %s under a stale admitted grant after reconnect', async (_mode, command) => {
    const counters = providerFixture();
    await connect('grant-a');
    const staleRevision = grantRevision;

    await connect('grant-b');
    const currentRevision = grantRevision;
    expect(currentRevision).toBeGreaterThan(staleRevision);

    const response = await internalCommand(command, staleRevision);
    expect(response.status).toBe(409);
    expect(await responseBody(response)).toEqual(expect.objectContaining({ code: 'grant_changed' }));
    expect(counters.setField).toBe(0);
    expect(counters.clearField).toBe(0);

    const current = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'task-a' },
    }, currentRevision);
    expect(current.status).toBe(200);
  });

  it('rejects cross-Workspace assignee and mention ids before writes leave the vault', async () => {
    const counters = providerFixture();
    await connect();

    const create = await internalCommand({
      operation: 'createTask',
      arguments: {
        workspaceId: '111',
        listId: '1112',
        name: 'A task',
        assigneeIds: ['9999'],
      },
    });
    const update = await internalCommand({
      operation: 'updateTask',
      arguments: {
        workspaceId: '111',
        taskId: 'task-a',
        assignees: { add: ['9999'] },
      },
    });
    const comment = await internalCommand({
      operation: 'createTaskComment',
      arguments: {
        workspaceId: '111',
        taskId: 'task-a',
        text: 'hello',
        mentionUserIds: ['9999'],
      },
    });
    const reply = await internalCommand({
      operation: 'replyToComment',
      arguments: {
        workspaceId: '111',
        taskId: 'task-a',
        commentId: '100',
        text: 'hello',
        mentionUserIds: ['9999'],
      },
    });

    for (const response of [create, update, comment, reply]) {
      expect(response.status).toBe(403);
      expect(await responseBody(response)).toEqual(expect.objectContaining({ code: 'resource_workspace_mismatch' }));
    }
    expect(counters.createTask).toBe(0);
    expect(counters.updateTask).toBe(0);
    expect(counters.createComment).toBe(0);
    expect(counters.replyComment).toBe(0);
  });

  it('rejects stale grant revisions for Custom Field set and clear before scope/provider work', async () => {
    const counters = providerFixture();
    await connect();
    const before = { ...counters };
    const staleRevision = Math.max(1, grantRevision - 1);

    const set = await internalCommand({
      operation: 'setCustomField',
      workspaceId: '111',
      taskId: 'task-a',
      fieldId: 'field-a',
      value: 'Ready',
    }, staleRevision);
    const clear = await internalCommand({
      operation: 'clearCustomField',
      workspaceId: '111',
      taskId: 'task-a',
      fieldId: 'field-a',
    }, staleRevision);

    for (const response of [set, clear]) {
      expect(response.status).toBe(409);
      expect(await responseBody(response)).toEqual(expect.objectContaining({ code: 'grant_changed' }));
    }
    expect(counters).toEqual(before);
  });

  it('rejects stale grant revisions and forged internal authority before any provider resource call', async () => {
    const counters = providerFixture();
    await connect();
    const before = { ...counters };

    const stale = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'task-a' },
    }, Math.max(1, grantRevision - 1));

    const forged = await doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Elara-Internal': 'forged',
        [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
      },
      body: JSON.stringify({
        operation: 'getTask',
        arguments: { workspaceId: '111', taskId: 'task-a' },
      }),
    }));

    expect(stale.status).toBe(409);
    expect(await responseBody(stale)).toEqual(expect.objectContaining({ code: 'grant_changed' }));
    expect(forged.status).toBe(401);
    expect(await responseBody(forged)).toEqual(expect.objectContaining({ code: 'auth' }));
    expect(counters).toEqual(before);
  });

  it('drops Workspace B immediately after reconnect while the provider token can still resolve B', async () => {
    let bTaskReads = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const auth = request.headers.get('Authorization') ?? '';

      if (url.pathname === '/api/v2/oauth/token') {
        const body = await request.clone().json() as { code?: string };
        return new Response(JSON.stringify({
          access_token: body.code === 'second-code' ? 'token-a-only' : 'token-a-and-b',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/team') {
        const teams = auth.endsWith('token-a-only')
          ? [{ id: '111', name: 'Workspace A', members: [{ user: { id: 183, username: 'Gareth' } }] }]
          : [
              { id: '111', name: 'Workspace A', members: [{ user: { id: 183, username: 'Gareth' } }] },
              { id: '222', name: 'Workspace B', members: [{ user: { id: 9999, username: 'Other' } }] },
            ];
        return new Response(JSON.stringify({ teams }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/task/task-b' && request.method === 'GET') {
        bTaskReads += 1;
        return new Response(JSON.stringify({
          id: 'task-b',
          name: 'SECRET_B_TASK',
          team_id: '222',
          list: { id: '2221' },
          space: { id: '2222' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unexpected reconnect-scope provider request: ${request.method} ${request.url}`);
    });

    await connect('first-code');
    const before = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '222', taskId: 'task-b' },
    });
    expect(before.status).toBe(200);
    expect(JSON.stringify(await responseBody(before))).toContain('SECRET_B_TASK');
    expect(bTaskReads).toBe(1);

    await connect('second-code');

    const removedWorkspace = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '222', taskId: 'task-b' },
    });
    expect(removedWorkspace.status).toBe(403);
    expect(await responseBody(removedWorkspace)).toEqual(expect.objectContaining({ code: 'workspace_forbidden' }));
    expect(bTaskReads).toBe(1);

    const smuggledUnderA = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'task-b' },
    });
    expect(smuggledUnderA.status).toBe(403);
    expect(await responseBody(smuggledUnderA)).toEqual(expect.objectContaining({ code: 'resource_workspace_mismatch' }));
    expect(bTaskReads).toBe(2);
  });

  it('fails closed when direct task ancestry is absent instead of guessing Workspace ownership', async () => {
    providerFixture();
    await connect();

    const response = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '111', taskId: 'no-ancestry' },
    });

    expect(response.status).toBe(502);
    expect(await responseBody(response)).toEqual(expect.objectContaining({
      code: 'resource_scope_unverifiable',
    }));
  });
});
