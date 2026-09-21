export interface KanbanFocusTarget {
  readonly listId: string;
  readonly taskId?: string;
}

export const KANBAN_FOCUS_EVENT = 'elara:kanban-focus';

function validTarget(value: unknown): value is KanbanFocusTarget {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.listId === 'string' && record.listId.trim().length > 0
    && (record.taskId === undefined || (typeof record.taskId === 'string' && record.taskId.trim().length > 0));
}

export function requestKanbanFocus(target: KanbanFocusTarget): boolean {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<KanbanFocusTarget>(KANBAN_FOCUS_EVENT, { detail: target }));
  return true;
}

export function subscribeKanbanFocus(listener: (target: KanbanFocusTarget) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onFocus = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (validTarget(detail)) listener({
      listId: detail.listId.trim(),
      ...(detail.taskId ? { taskId: detail.taskId.trim() } : {}),
    });
  };
  window.addEventListener(KANBAN_FOCUS_EVENT, onFocus);
  return () => window.removeEventListener(KANBAN_FOCUS_EVENT, onFocus);
}
