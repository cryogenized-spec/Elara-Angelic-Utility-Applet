import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callMcp, uploadArtifact } = vi.hoisted(() => ({
  callMcp: vi.fn(),
  uploadArtifact: vi.fn(),
}));

vi.mock('./mcp-client', () => ({
  callClickUpMcpTool: callMcp,
}));

vi.mock('./attachment-upload', () => ({
  uploadClickUpArtifact: uploadArtifact,
}));

import { googleToolRegistry } from '../google/tools/registry';
import { clickUpToolHandlers } from './tool-handlers';
import { resetClickUpMutationReplayForTests } from './mutation-replay';

function descriptor(name: 'clickup.createTask' | 'clickup.getTask') {
  const found = googleToolRegistry.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing descriptor for ${name}`);
  return found;
}

describe('ClickUp handler replay integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClickUpMutationReplayForTests();
  });

  it('passes Gemini call/turn identity into the create-task replay fence', async () => {
    callMcp.mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return { id: 'created-task' };
    });

    const handler = clickUpToolHandlers['clickup.createTask'];
    expect(handler).toBeDefined();

    const execution = {
      tool: 'clickup.createTask' as const,
      descriptor: descriptor('clickup.createTask'),
      capability: 'clickup.write' as const,
      risk: 'write' as const,
      arguments: { workspaceId: '999', listId: '123', name: 'Repair S56' },
      callId: 'call-create-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      isGenerationActive: () => true,
      providerGrantRevision: 17,
      providerAuthorityBinding: 'https://worker.example#installation',
    };

    const [first, second] = await Promise.all([
      handler!(execution),
      handler!(execution),
    ]);

    expect(first).toEqual({ id: 'created-task' });
    expect(second).toEqual({ id: 'created-task' });
    expect(callMcp).toHaveBeenCalledTimes(1);
    expect(callMcp).toHaveBeenCalledWith(
      'clickup.createTask',
      execution.arguments,
      undefined,
      {
        revision: 17,
        authorityBinding: 'https://worker.example#installation',
      },
    );
  });

  it('does not replay-fence ClickUp reads', async () => {
    callMcp.mockResolvedValue({ id: '86task' });
    const handler = clickUpToolHandlers['clickup.getTask'];
    expect(handler).toBeDefined();

    const execution = {
      tool: 'clickup.getTask' as const,
      descriptor: descriptor('clickup.getTask'),
      capability: 'clickup.read' as const,
      risk: 'read' as const,
      arguments: { workspaceId: '999', taskId: '86task' },
      callId: 'call-read-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      generationId: 'generation-1',
      isGenerationActive: () => true,
      providerGrantRevision: 17,
      providerAuthorityBinding: 'https://worker.example#installation',
    };

    await handler!(execution);
    await handler!(execution);

    expect(callMcp).toHaveBeenCalledTimes(2);
  });
});
