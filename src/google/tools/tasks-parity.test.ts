import { describe, expect, it } from 'vitest';
import { confirmationRequestForCall } from './executor';
import { googleGeminiFunctionDeclarations } from './gemini-declarations';
import { validateGoogleReadToolArguments } from './read-schemas';
import { googleToolRegistry } from './registry';
import { validateSemanticToolArguments } from './semantic-schemas';

function declaration(name: string) {
  const found = googleGeminiFunctionDeclarations.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing Gemini declaration: ${name}`);
  return found;
}

describe('Google Tasks Pass 2 semantic boundary', () => {
  it('accepts bounded semantic task creation and rejects raw provider task resources', () => {
    expect(validateSemanticToolArguments('tasks.createTask', {
      taskListId: 'list-1',
      title: 'Review inventory',
      notes: 'Check the latest counts',
      scheduledDate: '2026-09-30',
      parent: 'parent-1',
      previous: 'previous-1',
    })).toMatchObject({ title: 'Review inventory', scheduledDate: '2026-09-30' });

    expect(() => validateSemanticToolArguments('tasks.createTask', {
      taskListId: 'list-1',
      task: { title: 'raw provider object', due: '2026-09-30T15:00:00Z', hidden: true },
    })).toThrow();
  });

  it('enforces date-only task scheduling and meaningful task updates', () => {
    expect(() => validateSemanticToolArguments('tasks.createTask', {
      taskListId: 'list-1',
      title: 'Timed task',
      scheduledDate: '2026-09-30T15:00:00+02:00',
    })).toThrow(/scheduledDate/i);

    expect(() => validateSemanticToolArguments('tasks.updateTask', {
      taskListId: 'list-1',
      taskId: 'task-1',
    })).toThrow(/at least one task field change/i);

    expect(() => validateSemanticToolArguments('tasks.updateTask', {
      taskListId: 'list-1',
      taskId: 'task-1',
      scheduledDate: '2026-09-30',
      clearScheduledDate: true,
    })).toThrow(/cannot set and clear/i);
  });

  it('pins task-list parity and assigned-task reads in the read schema', () => {
    expect(validateGoogleReadToolArguments('tasks.listTaskLists', { maxResults: 100 })).toEqual({ maxResults: 100 });
    expect(validateGoogleReadToolArguments('tasks.getTaskList', { taskListId: 'list-1' })).toEqual({ taskListId: 'list-1' });
    expect(validateGoogleReadToolArguments('tasks.listTasks', {
      taskListId: 'list-1',
      showAssigned: true,
      maxResults: 100,
      dueMin: '2026-09-01T00:00:00+02:00',
    })).toMatchObject({ showAssigned: true, maxResults: 100 });

    expect(() => validateGoogleReadToolArguments('tasks.listTasks', {
      taskListId: 'list-1',
      dueMin: '2026-09-01T00:00:00',
    })).toThrow(/explicit UTC offset/i);
    expect(() => validateGoogleReadToolArguments('tasks.listTaskLists', { maxResults: 101 })).toThrow();
  });

  it('registers all Tasks operations with the expected risk and capability boundary', () => {
    const expected = new Map([
      ['tasks.listTaskLists', ['read', 'tasks.read']],
      ['tasks.getTaskList', ['read', 'tasks.read']],
      ['tasks.listTasks', ['read', 'tasks.read']],
      ['tasks.getTask', ['read', 'tasks.read']],
      ['tasks.createTaskList', ['write', 'tasks.write']],
      ['tasks.updateTaskList', ['write', 'tasks.write']],
      ['tasks.deleteTaskList', ['destructive', 'tasks.write']],
      ['tasks.createTask', ['write', 'tasks.write']],
      ['tasks.updateTask', ['write', 'tasks.write']],
      ['tasks.moveTask', ['write', 'tasks.write']],
      ['tasks.deleteTask', ['destructive', 'tasks.write']],
      ['tasks.clearCompleted', ['destructive', 'tasks.write']],
    ] as const);

    for (const [name, [risk, capability]] of expected) {
      expect(googleToolRegistry.find((entry) => entry.name === name)).toMatchObject({ name, risk, capability, exposure: 'gemini' });
    }
  });

  it('publishes semantic Gemini declarations rather than raw Task objects', () => {
    const taskLists = declaration('tasks.listTaskLists');
    expect(taskLists.parameters.properties.maxResults).toMatchObject({ maximum: 100 });

    const create = declaration('tasks.createTask');
    expect(create.parameters.required).toEqual(['taskListId', 'title']);
    expect(create.parameters.properties).toHaveProperty('scheduledDate');
    expect(create.parameters.properties).not.toHaveProperty('task');

    const update = declaration('tasks.updateTask');
    expect(update.parameters.required).toEqual(['taskListId', 'taskId']);
    expect(update.parameters.properties).toHaveProperty('clearScheduledDate');
    expect(update.parameters.properties).not.toHaveProperty('task');

    const move = declaration('tasks.moveTask');
    expect(move.parameters.required).toEqual(['taskListId', 'taskId']);
    expect(move.parameters.properties).toHaveProperty('destinationTaskListId');

    expect(declaration('tasks.getTaskList').parameters.required).toEqual(['taskListId']);
    expect(declaration('tasks.deleteTaskList').parameters.required).toEqual(['taskListId']);
  });

  it('accepts a bounded destination list for cross-list moves and rejects undeclared move fields', () => {
    expect(validateSemanticToolArguments('tasks.moveTask', {
      taskListId: 'list-1',
      taskId: 'task-1',
      destinationTaskListId: 'list-2',
      parent: 'parent-2',
      previous: 'previous-2',
    })).toEqual({
      taskListId: 'list-1',
      taskId: 'task-1',
      destinationTaskListId: 'list-2',
      parent: 'parent-2',
      previous: 'previous-2',
    });

    expect(() => validateSemanticToolArguments('tasks.moveTask', {
      taskListId: 'list-1',
      taskId: 'task-1',
      destinationTasklist: 'provider-raw-name',
    })).toThrow();
  });

  it('makes destructive confirmation consequences explicit', () => {
    const deleteTask = confirmationRequestForCall({
      tool: 'tasks.deleteTask',
      arguments: { taskListId: 'list-1', taskId: 'task-1' },
    }, new Date('2026-09-17T04:00:00Z'));
    expect(deleteTask?.resourceSummary).toMatch(/Docs or Chat/i);
    expect(deleteTask?.resourceSummary).toMatch(/originating assignment/i);

    const deleteList = confirmationRequestForCall({
      tool: 'tasks.deleteTaskList',
      arguments: { taskListId: 'list-1' },
    }, new Date('2026-09-17T04:00:00Z'));
    expect(deleteList?.resourceSummary).toMatch(/tasks it contains/i);
    expect(deleteList?.resourceSummary).toMatch(/Docs or Chat/i);
    expect(deleteList?.resourceSummary).toMatch(/originating assignment/i);

    const clear = confirmationRequestForCall({
      tool: 'tasks.clearCompleted',
      arguments: { taskListId: 'list-1' },
    }, new Date('2026-09-17T04:00:00Z'));
    expect(clear?.resourceSummary).toMatch(/hide/i);
  });

  it('explains hierarchy and cross-list destination semantics before a move is confirmed', () => {
    const move = confirmationRequestForCall({
      tool: 'tasks.moveTask',
      arguments: { taskListId: 'list-1', taskId: 'task-1' },
    }, new Date('2026-09-17T04:00:00Z'));
    expect(move?.resourceSummary).toMatch(/within list list-1/i);
    expect(move?.resourceSummary).toMatch(/top level/i);
    expect(move?.resourceSummary).toMatch(/first task/i);

    const crossListMove = confirmationRequestForCall({
      tool: 'tasks.moveTask',
      arguments: { taskListId: 'list-1', taskId: 'task-1', destinationTaskListId: 'list-2', parent: 'parent-2' },
    }, new Date('2026-09-17T04:00:00Z'));
    expect(crossListMove?.resourceSummary).toMatch(/from list list-1 to list list-2/i);
    expect(crossListMove?.resourceSummary).toMatch(/under parent parent-2/i);
  });
});
