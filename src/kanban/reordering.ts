import type { BoardTask } from "./store";

export interface TaskMove {
  listId: string;
  taskId: string;
  parent?: string;
  previous?: string;
}

/** Move before a sibling without reparenting, moving lists, or recreating a task. */
export function moveBefore(
  tasks: BoardTask[],
  source: BoardTask,
  target: BoardTask,
): TaskMove | null {
  if (
    source.id === target.id ||
    source.listId !== target.listId ||
    (source.parent ?? "") !== (target.parent ?? "")
  )
    return null;
  const siblings = tasks
    .filter(
      (task) =>
        task.listId === source.listId &&
        (task.parent ?? "") === (source.parent ?? ""),
    )
    .sort((a, b) => (a.position ?? "").localeCompare(b.position ?? ""));
  const from = siblings.findIndex((task) => task.id === source.id);
  const to = siblings.findIndex((task) => task.id === target.id);
  if (from < 0 || to < 0 || from + 1 === to) return null;
  const remaining = siblings.filter((task) => task.id !== source.id);
  const index = remaining.findIndex((task) => task.id === target.id);
  return {
    listId: source.listId,
    taskId: source.id,
    parent: source.parent,
    previous: remaining[index - 1]?.id,
  };
}

export function moveOne(
  tasks: BoardTask[],
  source: BoardTask,
  direction: -1 | 1,
): TaskMove | null {
  const siblings = tasks
    .filter(
      (task) =>
        task.listId === source.listId &&
        (task.parent ?? "") === (source.parent ?? ""),
    )
    .sort((a, b) => (a.position ?? "").localeCompare(b.position ?? ""));
  const index = siblings.findIndex((task) => task.id === source.id);
  if (
    index < 0 ||
    index + direction < 0 ||
    index + direction >= siblings.length
  )
    return null;
  return {
    listId: source.listId,
    taskId: source.id,
    parent: source.parent,
    previous:
      direction === -1 ? siblings[index - 2]?.id : siblings[index + 1].id,
  };
}
