import { taskService } from './google-port';
import type { GoogleTaskStatus } from './google-port';

export function patchBoardTask(taskListId: string, taskId: string, patch: { title?: string; notes?: string; scheduledDate?: string | null; status?: GoogleTaskStatus }, etag?: string) {
  return taskService.updateSemanticTask({ taskListId, taskId, ...patch, scheduledDate: patch.scheduledDate ?? undefined, clearScheduledDate: patch.scheduledDate === null, etag });
}
export function createBoardTask(taskListId: string, task: { title: string; notes?: string; scheduledDate?: string }) {
  return taskService.createSemanticTask({ taskListId, ...task });
}
