import { orderedTasks, type BoardTask } from './store';

export type TaskSortField = 'provider' | 'created' | 'due';
export type SortDirection = 'asc' | 'desc';

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function taskCreationTimestamp(task: BoardTask, fallbackMs: number): number | null {
  return timestamp(task.local?.createdAt)
    ?? timestamp(task.local?.firstSeenAt)
    ?? timestamp(task.updated)
    ?? (Number.isFinite(fallbackMs) ? fallbackMs : null);
}

export function taskDueSortKey(task: BoardTask): string | null {
  const date = task.scheduledDate?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = task.local?.dueTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.local.dueTime)
    ? task.local.dueTime
    : '23:59';
  return `${date}T${time}`;
}

function compareNullable<T>(
  left: T | null,
  right: T | null,
  direction: SortDirection,
  compare: (a: T, b: T) => number,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const order = compare(left, right);
  return direction === 'asc' ? order : -order;
}

/**
 * Provider order keeps Google's sibling hierarchy untouched. Created/due sorting
 * sorts sibling groups only, so subtasks stay attached to their parent.
 */
export function sortTasksForView(
  tasks: BoardTask[],
  field: TaskSortField,
  direction: SortDirection,
  fallbackMs: number,
): BoardTask[] {
  const providerOrdered = orderedTasks(tasks);
  if (field === 'provider') return providerOrdered;

  const ids = new Set(providerOrdered.map((task) => task.id));
  const byParent = new Map<string, BoardTask[]>();
  const roots: BoardTask[] = [];
  for (const task of providerOrdered) {
    if (task.parent && ids.has(task.parent)) {
      const siblings = byParent.get(task.parent);
      if (siblings) siblings.push(task);
      else byParent.set(task.parent, [task]);
    } else {
      roots.push(task);
    }
  }

  const compareTasks = (a: BoardTask, b: BoardTask) => {
    const result = field === 'created'
      ? compareNullable(
          taskCreationTimestamp(a, fallbackMs),
          taskCreationTimestamp(b, fallbackMs),
          direction,
          (left, right) => left - right,
        )
      : compareNullable(
          taskDueSortKey(a),
          taskDueSortKey(b),
          direction,
          (left, right) => left.localeCompare(right),
        );
    if (result !== 0) return result;
    return (a.position ?? '').localeCompare(b.position ?? '');
  };

  roots.sort(compareTasks);
  for (const siblings of byParent.values()) siblings.sort(compareTasks);

  const result: BoardTask[] = [];
  const visited = new Set<string>();
  const append = (root: BoardTask) => {
    const stack = [root];
    while (stack.length) {
      const task = stack.pop()!;
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      result.push(task);
      const children = byParent.get(task.id) ?? [];
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  };
  roots.forEach(append);
  providerOrdered.forEach(append);
  return result;
}

export function normalizeLabelName(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 48);
}

const LABEL_COLORS = ['violet', 'blue', 'amber', 'green', 'rose', 'cyan'] as const;

export function labelColorForName(name: string): typeof LABEL_COLORS[number] {
  let hash = 0;
  for (const char of name.toLocaleLowerCase()) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}
