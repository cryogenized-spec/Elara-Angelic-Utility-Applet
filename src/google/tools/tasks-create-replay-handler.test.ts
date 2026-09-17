import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTaskList: vi.fn(),
  createSemanticTask: vi.fn(),
}));

vi.mock('../tasks/service', () => ({
  GoogleTasksService: class {
    createTaskList = mocks.createTaskList;
    createSemanticTask = mocks.createSemanticTask;
  },
}));

import { resetTaskCreateReplayForTests } from '../tasks/create-replay';
import { googleServiceToolHandlers } from './service-handlers';
import { googleToolRegistry } from './registry';
import type { GoogleToolExecutionContext } from './executor';

function context(tool: 'tasks.createTask' | 'tasks.createTaskList', arguments_: Record<string, unknown>, callId: string): GoogleToolExecutionContext {
  const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
  if (!descriptor) throw new Error(`Missing descriptor for ${tool}`);
  return {
    tool,
    descriptor,
    capability: descriptor.capability as GoogleToolExecutionContext['capability'],
    risk: descriptor.risk,
    arguments: arguments_,
    callId,
    conversationId: 'conversation-1',
    messageId: 'message-1',
    generationId: 'generation-1',
  };
}

describe('Tasks create handler replay safety', () => {
  beforeEach(() => {
    resetTaskCreateReplayForTests();
    mocks.createTaskList.mockReset();
    mocks.createSemanticTask.mockReset();
  });

  it('does not POST the same task-list create call twice', async () => {
    mocks.createTaskList.mockResolvedValue({ id: 'list-1', title: 'Work' });
    const handler = googleServiceToolHandlers['tasks.createTaskList'];
    expect(handler).toBeTypeOf('function');
    const call = context('tasks.createTaskList', { title: 'Work' }, 'call-list-1');

    const first = await handler!(call);
    const second = await handler!(call);

    expect(first).toEqual({ id: 'list-1', title: 'Work' });
    expect(second).toEqual(first);
    expect(mocks.createTaskList).toHaveBeenCalledTimes(1);
  });

  it('does not POST the same task create call twice but preserves distinct identical calls', async () => {
    mocks.createSemanticTask
      .mockResolvedValueOnce({ id: 'task-1', title: 'Review inventory' })
      .mockResolvedValueOnce({ id: 'task-2', title: 'Review inventory' });
    const handler = googleServiceToolHandlers['tasks.createTask'];
    expect(handler).toBeTypeOf('function');
    const args = { taskListId: 'list-1', title: 'Review inventory', scheduledDate: '2026-09-30' };

    const firstCall = context('tasks.createTask', args, 'call-task-1');
    await handler!(firstCall);
    await handler!(firstCall);
    await handler!(context('tasks.createTask', args, 'call-task-2'));

    expect(mocks.createSemanticTask).toHaveBeenCalledTimes(2);
    expect(mocks.createSemanticTask).toHaveBeenNthCalledWith(1, expect.objectContaining(args));
    expect(mocks.createSemanticTask).toHaveBeenNthCalledWith(2, expect.objectContaining(args));
  });
});
