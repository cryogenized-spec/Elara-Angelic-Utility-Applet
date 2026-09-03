import { z } from 'zod';

export const googleToolNameSchema = z.enum([
  'calendar.listEvents',
  'tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask', 'tasks.createTask', 'tasks.updateTask', 'tasks.moveTask', 'tasks.deleteTask', 'tasks.clearCompleted',
  'docs.getDocument', 'docs.createDocument', 'docs.batchUpdate',
  'chat.listMessages', 'chat.getMessage', 'chat.createMessage', 'chat.updateMessage', 'chat.deleteMessage',
  'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel', 'gmail.modifyMessage', 'gmail.modifyThread', 'gmail.trashMessage', 'gmail.untrashMessage', 'gmail.trashThread', 'gmail.untrashThread', 'gmail.createLabel', 'gmail.updateLabel', 'gmail.deleteLabel', 'gmail.sendMessage',
]);

export type GoogleToolName = z.infer<typeof googleToolNameSchema>;

export const googleToolCallSchema = z.object({
  tool: googleToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export type GoogleToolCall = z.infer<typeof googleToolCallSchema>;

export type GoogleToolRisk = 'read' | 'write' | 'destructive' | 'send';

export interface GoogleToolDescriptor {
  readonly name: GoogleToolName;
  readonly risk: GoogleToolRisk;
  readonly capability: string;
  readonly description: string;
}
