import type { GoogleTaskStatus, TaskWriter } from './google-port';

export function patchBoardTask(service: TaskWriter, taskListId: string, taskId: string, patch: { title?: string; notes?: string; scheduledDate?: string | null; status?: GoogleTaskStatus }, etag?: string) {
  return service.updateSemanticTask({ taskListId, taskId, ...patch, scheduledDate: patch.scheduledDate ?? undefined, clearScheduledDate: patch.scheduledDate === null, etag });
}
export function createBoardTask(service: TaskWriter, taskListId: string, task: { title: string; notes?: string; scheduledDate?: string }) {
  return service.createSemanticTask({ taskListId, ...task });
}
