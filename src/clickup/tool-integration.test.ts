import { describe, expect, it, vi } from 'vitest';
import {
  CLICKUP_TOOL_NAMES,
  clickUpToolJsonSchema,
  clickupToolCatalog,
} from './tool-schema';
import { googleToolNameSchema } from '../google/tools/contracts';
import { googleToolRegistry } from '../google/tools/registry';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import {
  confirmationRequestForCall,
  executeGoogleTool,
} from '../google/tools/executor';

const googleOauth = {
  authorize: async (capability: never) => ({ capability, fetch: async () => new Response('{}') }),
  getStatus: async () => ({
    state: 'connected' as const,
    grantedCapabilities: [],
    enabledCapabilities: [],
    grantedProviderScopes: [],
    sessionReady: true,
  }),
  disconnect: async () => undefined,
};

const connectedStatus = {
  connected: true as const,
  workspaces: [{ id: '999', name: 'Workspace' }],
  account: { id: '183' },
  updatedAt: 1,
};

const clickupConnected = {
  getStatus: async () => connectedStatus,
  getExecutionGrant: async () => ({
    status: connectedStatus,
    authorityBinding: 'https://worker.example#test-installation',
    revision: 1,
  }),
  beginConnect: async () => { throw new Error('not used'); },
  completeConnect: async () => { throw new Error('not used'); },
  disconnect: async () => undefined,
};

const clickupDisconnected = {
  ...clickupConnected,
  getStatus: async () => ({ connected: false as const, workspaces: [] }),
  getExecutionGrant: async () => ({
    status: { connected: false as const, workspaces: [] },
    authorityBinding: 'https://worker.example#test-installation',
    revision: 0,
  }),
};

const sampleArguments: Record<string, Record<string, unknown>> = {
  'clickup.searchTasks': { workspaceId: '999', query: 'repair' },
  'clickup.getTask': { workspaceId: '999', taskId: '86task' },
  'clickup.getTaskContext': { workspaceId: '999', taskId: '86task' },
  'clickup.getTaskComments': { workspaceId: '999', taskId: '86task' },
  'clickup.resolveAssignees': { workspaceId: '999', names: ['Gareth'] },
  'clickup.listHierarchy': { workspaceId: '999' },
  'clickup.createTask': { workspaceId: '999', listId: '123', name: 'Repair S56' },
  'clickup.updateTask': { workspaceId: '999', taskId: '86task', status: 'complete' },
  'clickup.createTaskComment': { workspaceId: '999', taskId: '86task', text: 'Inspection complete.' },
  'clickup.replyToComment': { workspaceId: '999', taskId: '86task', commentId: '456', text: 'Confirmed.' },
  'clickup.setCustomField': { workspaceId: '999', taskId: '86task', fieldId: 'field_1', mode: 'set', value: 'Ready' },
  'clickup.attachArtifact': { workspaceId: '999', taskId: '86task', artifactId: 'artifact-1' },
};

describe('ClickUp integration with Elara model-tool authority', () => {
  it('registers every ClickUp tool in the existing canonical name schema and browser execution plane', () => {
    for (const name of CLICKUP_TOOL_NAMES) {
      expect(googleToolNameSchema.parse(name)).toBe(name);
      const descriptor = googleToolRegistry.find((entry) => entry.name === name);
      expect(descriptor, name).toEqual(expect.objectContaining({
        name,
        risk: clickupToolCatalog[name].risk,
        capability: clickupToolCatalog[name].risk === 'read' ? 'clickup.read' : 'clickup.write',
        exposure: 'gemini',
        executionPlane: 'browser',
        description: clickupToolCatalog[name].description,
      }));
    }
  });

  it('gives Gemini the exact canonical schema that MCP publishes', () => {
    for (const name of CLICKUP_TOOL_NAMES) {
      const declaration = googleGeminiFunctionDeclarations.find((entry) => entry.name === name);
      expect(declaration, name).toBeDefined();
      expect(declaration?.description, name).toBe(clickupToolCatalog[name].description);
      expect(declaration?.parameters, name).toEqual(clickUpToolJsonSchema(name));
    }
  });

  it('generates existing confirmation-authority requests for every ClickUp mutation and none for reads', () => {
    for (const name of CLICKUP_TOOL_NAMES) {
      const request = confirmationRequestForCall({
        tool: name,
        arguments: sampleArguments[name],
      }, new Date('2026-09-21T12:00:00Z'));

      if (clickupToolCatalog[name].risk === 'write') {
        expect(request, name).toEqual(expect.objectContaining({
          tool: name,
          risk: 'write',
          requestedAt: '2026-09-21T12:00:00.000Z',
        }));
      } else {
        expect(request, name).toBeNull();
      }
    }
  });

  it('presents ClickUp comments and attachments without debug-oriented payload details', () => {
    const comment = confirmationRequestForCall({
      tool: 'clickup.createTaskComment',
      arguments: {
        workspaceId: '999',
        taskId: '86task',
        text: 'Inspection complete.',
        mentionUserIds: ['18', '27'],
        notifyAll: false,
      },
    });
    expect(comment?.reviewText).toBe('Inspection complete.');
    expect(comment?.reviewText).not.toContain('workspaceId');
    expect(comment?.resourceSummary).toContain('Mention ClickUp member IDs 18, 27');
    expect(comment?.resourceSummary).toContain('notify everyone: No');

    const notifyAll = confirmationRequestForCall({
      tool: 'clickup.replyToComment',
      arguments: {
        workspaceId: '999',
        taskId: '86task',
        commentId: '456',
        text: 'Confirmed.',
        notifyAll: true,
      },
    });
    expect(notifyAll?.resourceSummary).toContain('No direct member mentions');
    expect(notifyAll?.resourceSummary).toContain('notify everyone: Yes');

    const attachment = confirmationRequestForCall({
      tool: 'clickup.attachArtifact',
      arguments: { workspaceId: '999', taskId: '86task', artifactId: 'artifact-1' },
    }, new Date('2026-09-21T12:00:00Z'), {
      clickupArtifactSnapshot: {
        artifactId: 'artifact-1',
        artifactName: 'inspection.pdf',
        uploadName: 'inspection.pdf',
        mimeType: 'application/pdf',
        metadataSize: 1200,
        payloadSize: 1200,
        sha256: 'a'.repeat(64),
        blob: new Blob(['approved'], { type: 'application/pdf' }),
      },
    });
    expect(attachment?.resourceSummary).toContain('approved file below');
    expect(attachment?.resourceSummary).not.toContain('SHA-256');
    expect(attachment?.reviewText).toBeUndefined();
    expect(attachment?.attachmentReview).toEqual({
      name: 'inspection.pdf',
      uploadName: 'inspection.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
    });
  });

  it('blocks a disconnected ClickUp tool before its handler can execute', async () => {
    const handler = vi.fn(async () => ({ id: '86task' }));
    const result = await executeGoogleTool({
      tool: 'clickup.getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, {
      oauth: googleOauth,
      clickupOAuth: clickupDisconnected,
      handlers: { 'clickup.getTask': handler },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'AUTHORIZATION_REQUIRED' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('executes a connected ClickUp read through the existing handler authority', async () => {
    const handler = vi.fn(async () => ({ trust: 'untrusted-external', provider: 'clickup', id: '86task' }));
    const result = await executeGoogleTool({
      tool: 'clickup.getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, {
      oauth: googleOauth,
      clickupOAuth: clickupConnected,
      handlers: { 'clickup.getTask': handler },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      result: { trust: 'untrusted-external', provider: 'clickup', id: '86task' },
    }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not execute a connected ClickUp mutation until the existing confirmation authority approves it', async () => {
    const handler = vi.fn(async () => ({ id: 'new-task' }));
    const declined = await executeGoogleTool({
      tool: 'clickup.createTask',
      arguments: { workspaceId: '999', listId: '123', name: 'Repair S56' },
    }, {
      oauth: googleOauth,
      clickupOAuth: clickupConnected,
      handlers: { 'clickup.createTask': handler },
      confirm: async () => false,
    });
    expect(declined).toEqual(expect.objectContaining({ ok: false, code: 'USER_DECLINED' }));
    expect(handler).not.toHaveBeenCalled();

    const approved = await executeGoogleTool({
      tool: 'clickup.createTask',
      arguments: { workspaceId: '999', listId: '123', name: 'Repair S56' },
    }, {
      oauth: googleOauth,
      clickupOAuth: clickupConnected,
      handlers: { 'clickup.createTask': handler },
      confirm: async () => true,
    });
    expect(approved).toEqual(expect.objectContaining({ ok: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({
      providerGrantRevision: 1,
      providerAuthorityBinding: 'https://worker.example#test-installation',
    }));
  });

  it('does not execute an approved ClickUp mutation if the provider grant changes while confirmation is open', async () => {
    const handler = vi.fn(async () => ({ id: 'new-task' }));
    let reads = 0;
    const switchingAuthority = {
      ...clickupConnected,
      getExecutionGrant: async () => {
        reads += 1;
        const revision = reads === 1 ? 11 : 12;
        return {
          status: {
            ...connectedStatus,
            account: { id: reads === 1 ? '183' : '456' },
            updatedAt: revision,
          },
          authorityBinding: 'https://worker.example#test-installation',
          revision,
        };
      },
    };

    const result = await executeGoogleTool({
      tool: 'clickup.createTask',
      arguments: { workspaceId: '999', listId: '123', name: 'Repair S56' },
    }, {
      oauth: googleOauth,
      clickupOAuth: switchingAuthority,
      handlers: { 'clickup.createTask': handler },
      confirm: async () => true,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'AUTHORIZATION_REQUIRED' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['set', { workspaceId: '999', taskId: '86task', fieldId: 'field_1', mode: 'set' as const, value: 'Ready' }],
    ['clear', { workspaceId: '999', taskId: '86task', fieldId: 'field_1', mode: 'clear' as const }],
  ])('does not execute Custom Field %s if the ClickUp grant changes during confirmation', async (_mode, argumentsValue) => {
    const handler = vi.fn(async () => ({ ok: true }));
    let reads = 0;
    const switchingAuthority = {
      ...clickupConnected,
      getExecutionGrant: async () => {
        reads += 1;
        const revision = reads === 1 ? 21 : 22;
        return {
          status: {
            ...connectedStatus,
            account: { id: reads === 1 ? '183' : '456' },
            updatedAt: revision,
          },
          authorityBinding: 'https://worker.example#test-installation',
          revision,
        };
      },
    };

    const result = await executeGoogleTool({
      tool: 'clickup.setCustomField',
      arguments: argumentsValue,
    }, {
      oauth: googleOauth,
      clickupOAuth: switchingAuthority,
      handlers: { 'clickup.setCustomField': handler },
      confirm: async () => true,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'AUTHORIZATION_REQUIRED' }));
    expect(handler).not.toHaveBeenCalled();
  });
});
