import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTaskCreateReplayForTests, runTaskCreateOnce } from './create-replay';

const baseContext = {
  tool: 'tasks.createTask' as const,
  callId: 'call-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  generationId: 'generation-1',
};

describe('Google Tasks create replay fence', () => {
  beforeEach(() => resetTaskCreateReplayForTests());

  it('executes the same call id and payload only once in the same elected turn', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'task-1' });
    const payload = { taskListId: 'list-1', title: 'Review inventory' };

    const first = await runTaskCreateOnce(baseContext, payload, operation, 1000);
    const second = await runTaskCreateOnce(baseContext, payload, operation, 1001);

    expect(first).toEqual({ id: 'task-1' });
    expect(second).toEqual({ id: 'task-1' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retains same-call replay protection for the full elected turn rather than a fixed TTL', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'task-1' });
    const payload = { taskListId: 'list-1', title: 'Long-running turn' };

    await runTaskCreateOnce(baseContext, payload, operation, 1000);
    await runTaskCreateOnce(baseContext, payload, operation, 1000 + 24 * 60 * 60 * 1000);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the same call id is replayed with changed arguments even much later in the same turn', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'task-1' });
    await runTaskCreateOnce(baseContext, { taskListId: 'list-1', title: 'First' }, operation, 1000);

    await expect(runTaskCreateOnce(
      baseContext,
      { taskListId: 'list-1', title: 'Changed' },
      operation,
      1000 + 24 * 60 * 60 * 1000,
    )).rejects.toThrow(/changed arguments/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate two distinct calls that intentionally create identical tasks', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'task-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'task-2' });
    const payload = { taskListId: 'list-1', title: 'Same title' };

    await runTaskCreateOnce(baseContext, payload, firstOperation, 1000);
    await runTaskCreateOnce({ ...baseContext, callId: 'call-2' }, payload, secondOperation, 1001);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('clears prior replay state when a new elected turn arrives', async () => {
    const firstOperation = vi.fn().mockResolvedValue({ id: 'task-1' });
    const secondOperation = vi.fn().mockResolvedValue({ id: 'task-2' });
    const payload = { taskListId: 'list-1', title: 'Same call id, new turn' };

    await runTaskCreateOnce(baseContext, payload, firstOperation, 1000);
    await runTaskCreateOnce({ ...baseContext, generationId: 'generation-2' }, payload, secondOperation, 1001);

    expect(firstOperation).toHaveBeenCalledOnce();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('does not claim replay safety when elected-turn provenance is unavailable', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'task-1' });
    const context = { tool: 'tasks.createTask' as const, callId: 'call-1' };

    await runTaskCreateOnce(context, { title: 'Task' }, operation, 1000);
    await runTaskCreateOnce(context, { title: 'Task' }, operation, 1001);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retains an ambiguous rejection for the same call instead of issuing a second POST', async () => {
    const failure = new Error('network response lost');
    const operation = vi.fn().mockRejectedValue(failure);
    const payload = { taskListId: 'list-1', title: 'Review inventory' };

    await expect(runTaskCreateOnce(baseContext, payload, operation, 1000)).rejects.toThrow('network response lost');
    await expect(runTaskCreateOnce(baseContext, payload, operation, 1000 + 24 * 60 * 60 * 1000)).rejects.toThrow('network response lost');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
