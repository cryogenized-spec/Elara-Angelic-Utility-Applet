import { z } from 'zod';
import { taskPatchSchema } from '../tasks/service';
const id = z.string().trim().min(1).max(500);
const title = z.string().trim().min(1).max(1024);
const etag = z.string().trim().min(1).max(1024);
export const kanbanToolSchemas = {
  'tasks.createTaskList': z.object({ title }).strict(),
  'tasks.renameTaskList': z.object({ taskListId: id, title, etag: etag.optional() }).strict(),
  'tasks.deleteTaskList': z.object({ taskListId: id, etag: etag.optional() }).strict(),
  'tasks.patchTask': z.object({ taskListId: id, taskId: id, patch: taskPatchSchema, etag }).strict(),
};
export type KanbanToolName = keyof typeof kanbanToolSchemas;
