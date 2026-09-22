import { describe, expect, it } from 'vitest';
import type { BoardTask } from './store';
import {
  labelColorForName,
  normalizeLabelName,
  sortTasksForView,
  taskCreationTimestamp,
  taskDueSortKey,
} from './view';

function task(id: string, extra: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    listId: 'work',
    title: id,
    status: 'needsAction',
    position: id,
    ...extra,
  };
}

describe('Kanban view metadata', () => {
  it('sorts creation timestamps with time precision and keeps unknown timestamps last', () => {
    const tasks = [
      task('late', { local: { createdAt: '2026-09-21T15:30:00Z', labelIds: [] } }),
      task('unknown'),
      task('early', { local: { createdAt: '2026-09-21T08:15:00Z', labelIds: [] } }),
    ];
    expect(sortTasksForView(tasks, 'created', 'asc', Number.NaN).map(({ id }) => id))
      .toEqual(['early', 'late', 'unknown']);
    expect(sortTasksForView(tasks, 'created', 'desc', Number.NaN).map(({ id }) => id))
      .toEqual(['late', 'early', 'unknown']);
  });

  it('combines the Google due date with Elara app-only due time', () => {
    const morning = task('morning', {
      scheduledDate: '2026-09-22',
      local: { dueTime: '08:00', labelIds: [] },
    });
    const evening = task('evening', {
      scheduledDate: '2026-09-22',
      local: { dueTime: '17:30', labelIds: [] },
    });
    const noTime = task('no-time', { scheduledDate: '2026-09-22' });
    const undated = task('undated');
    expect(taskDueSortKey(morning)).toBe('2026-09-22T08:00');
    expect(sortTasksForView([noTime, evening, undated, morning], 'due', 'asc', 0).map(({ id }) => id))
      .toEqual(['morning', 'evening', 'no-time', 'undated']);
  });

  it('keeps subtasks attached to their sorted parent group', () => {
    const parentLate = task('parent-late', {
      position: '0001',
      local: { createdAt: '2026-09-21T12:00:00Z', labelIds: [] },
    });
    const child = task('child', {
      parent: 'parent-late',
      position: '0002',
      local: { createdAt: '2026-09-21T07:00:00Z', labelIds: [] },
    });
    const parentEarly = task('parent-early', {
      position: '0003',
      local: { createdAt: '2026-09-21T08:00:00Z', labelIds: [] },
    });
    expect(sortTasksForView([parentLate, child, parentEarly], 'created', 'asc', 0).map(({ id }) => id))
      .toEqual(['parent-early', 'parent-late', 'child']);
  });

  it('normalizes hashtag entry and assigns a deterministic label colour', () => {
    expect(normalizeLabelName('  ##supplier   follow-up  ')).toBe('supplier follow-up');
    expect(labelColorForName('Supplier')).toBe(labelColorForName('supplier'));
  });

  it('uses first-seen or provider-updated timestamps when exact creation is unavailable', () => {
    expect(taskCreationTimestamp(task('seen', {
      local: { firstSeenAt: '2026-09-21T09:00:00Z', labelIds: [] },
      updated: '2026-09-21T12:00:00Z',
    }), 0)).toBe(Date.parse('2026-09-21T09:00:00Z'));
    expect(taskCreationTimestamp(task('provider', {
      updated: '2026-09-21T12:00:00Z',
    }), 0)).toBe(Date.parse('2026-09-21T12:00:00Z'));
  });
});
