import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClickUpArtifactApprovalSnapshot } from './attachment-authority';
import {
  resetClickUpMutationReplayForTests,
  runClickUpMutationOnce,
  type ClickUpMutationReplayContext,
} from './mutation-replay';

function context(overrides: Partial<ClickUpMutationReplayContext> = {}): ClickUpMutationReplayContext {
  return {
    tool: 'clickup.createTask',
    callId: 'call-1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    generationId: 'generation-1',
    isGenerationActive: () => true,
    ...overrides,
  };
}

function artifactSnapshot(sha256 = 'a'.repeat(64)): ClickUpArtifactApprovalSnapshot {
  return {
    artifactId: 'artifact-1',
    artifactName: 'repair.txt',
    uploadName: 'repair.txt',
    mimeType: 'text/plain',
    metadataSize: 8,
    payloadSize: 8,
    sha256,
    blob: new Blob(['approved'], { type: 'text/plain' }),
  };
}

describe('ClickUp live-turn mutation replay fence', () => {
  beforeEach(() => {
    resetClickUpMutationReplayForTests();
  });

  it('shares one provider operation across concurrent exact replays of the same Gemini call', async () => {
    const operation = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return { id: 'created-task' };
    });
    const payload = { workspaceId: '999', listId: '123', name: 'Repair S56' };
    const replayContext = context();

    const [first, second] = await Promise.all([
      runClickUpMutationOnce(replayContext, payload, operation),
      runClickUpMutationOnce(replayContext, payload, operation),
    ]);

    expect(first).toEqual({ id: 'created-task' });
    expect(second).toEqual({ id: 'created-task' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('replays the same ambiguous failure instead of issuing a second provider mutation', async () => {
    const operation = vi.fn(async () => {
      throw new Error('provider outcome unknown');
    });
    const payload = { workspaceId: '999', taskId: '86task', text: 'Inspection complete.' };
    const replayContext = context({ tool: 'clickup.createTaskComment' });

    await expect(runClickUpMutationOnce(replayContext, payload, operation)).rejects.toThrow('provider outcome unknown');
    await expect(runClickUpMutationOnce(replayContext, payload, operation)).rejects.toThrow('provider outcome unknown');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the same call id is replayed with changed arguments', async () => {
    const operation = vi.fn(async () => ({ id: 'created-task' }));
    const replayContext = context();

    await expect(runClickUpMutationOnce(
      replayContext,
      { workspaceId: '999', listId: '123', name: 'Repair S56' },
      operation,
    )).resolves.toEqual({ id: 'created-task' });

    await expect(runClickUpMutationOnce(
      replayContext,
      { workspaceId: '999', listId: '123', name: 'Different task' },
      operation,
    )).rejects.toThrow(/changed arguments/i);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not collide elected turns when identity components contain delimiter characters', async () => {
    const operation = vi.fn(async (label: string) => ({ label }));
    const payload = { workspaceId: '999', listId: '123', name: 'Repair S56' };

    const firstContext = context({
      conversationId: 'a',
      messageId: 'b\u0000c',
      generationId: 'd',
    });
    const secondContext = context({
      conversationId: 'a\u0000b',
      messageId: 'c',
      generationId: 'd',
    });

    const first = await runClickUpMutationOnce(
      firstContext,
      payload,
      () => operation('first'),
    );
    const second = await runClickUpMutationOnce(
      secondContext,
      payload,
      () => operation('second'),
    );

    expect(first).toEqual({ label: 'first' });
    expect(second).toEqual({ label: 'second' });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct call ids independent even when their payloads are identical', async () => {
    const operation = vi.fn(async () => ({ ok: true }));
    const payload = { workspaceId: '999', taskId: '86task', text: 'Confirmed.' };

    await runClickUpMutationOnce(
      context({ tool: 'clickup.replyToComment', callId: 'call-a' }),
      payload,
      operation,
    );
    await runClickUpMutationOnce(
      context({ tool: 'clickup.replyToComment', callId: 'call-b' }),
      payload,
      operation,
    );

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('binds an attachment replay to the exact approved snapshot digest and upload metadata', async () => {
    const operation = vi.fn(async () => ({ attachmentId: '77' }));
    const payload = {
      workspaceId: '999',
      taskId: '86task',
      artifactId: 'artifact-1',
      filename: 'repair.txt',
    };
    const replayContext = context({ tool: 'clickup.attachArtifact' });

    await expect(runClickUpMutationOnce(
      replayContext,
      payload,
      operation,
      artifactSnapshot('a'.repeat(64)),
    )).resolves.toEqual({ attachmentId: '77' });

    await expect(runClickUpMutationOnce(
      replayContext,
      payload,
      operation,
      artifactSnapshot('b'.repeat(64)),
    )).rejects.toThrow(/changed arguments/i);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not start a mutation after the elected generation loses authority', async () => {
    const operation = vi.fn(async () => ({ ok: true }));

    await expect(runClickUpMutationOnce(
      context({ isGenerationActive: () => false }),
      { workspaceId: '999', listId: '123', name: 'Do not create' },
      operation,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(operation).not.toHaveBeenCalled();
  });
});
