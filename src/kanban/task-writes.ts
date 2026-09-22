import type { GoogleTask, GoogleTaskStatus, TaskWriter } from './google-port';
import type { BoardTask, TaskLocalMetadata } from './store';

export function patchBoardTask(service: TaskWriter, taskListId: string, taskId: string, patch: { title?: string; notes?: string; scheduledDate?: string | null; status?: GoogleTaskStatus }, etag?: string) {
  return service.updateSemanticTask({ taskListId, taskId, ...patch, scheduledDate: patch.scheduledDate ?? undefined, clearScheduledDate: patch.scheduledDate === null, etag });
}
export function createBoardTask(service: TaskWriter, taskListId: string, task: { title: string; notes?: string; scheduledDate?: string }) {
  return service.createSemanticTask({ taskListId, ...task });
}

/** Keep the provider-returned identity/ETag immediately after an accepted write,
 * before fallible local metadata persistence. This makes a later retry use the
 * provider's current concurrency token rather than replaying a stale one. */
export function acceptedBoardTask(
  providerTask: GoogleTask,
  listId: string,
  previousLocal: TaskLocalMetadata | undefined,
  createdAt: string | undefined,
  dueTime: string | undefined,
  timeZone: string | undefined,
  labelIds: string[],
): BoardTask {
  return {
    ...providerTask,
    listId,
    local: {
      ...(previousLocal ?? {}),
      createdAt: createdAt ?? previousLocal?.createdAt,
      firstSeenAt: previousLocal?.firstSeenAt ?? createdAt,
      dueTime,
      timeZone,
      labelIds,
    },
  };
}
