import { z } from 'zod';

export const googleToolNameSchema = z.enum([
  'calendar.listEvents', 'calendar.createEvent',
  'tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask', 'tasks.createTask', 'tasks.updateTask', 'tasks.moveTask', 'tasks.deleteTask', 'tasks.clearCompleted',
  'docs.getDocument', 'docs.inspectDocument', 'docs.createDocument', 'docs.insertText', 'docs.appendParagraph', 'docs.replaceText', 'docs.batchUpdate',
  'chat.listMessages', 'chat.getMessage', 'chat.createMessage', 'chat.updateMessage', 'chat.deleteMessage',
  'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel', 'gmail.modifyMessage', 'gmail.modifyThread', 'gmail.trashMessage', 'gmail.untrashMessage', 'gmail.trashThread', 'gmail.untrashThread', 'gmail.createLabel', 'gmail.updateLabel', 'gmail.deleteLabel', 'gmail.sendMessage',
  'drive.searchFiles', 'drive.searchLibrary', 'drive.getFile', 'drive.downloadFile', 'drive.createFile', 'drive.updateFile', 'drive.moveFile',
  'sheets.getSpreadsheet', 'sheets.readRange', 'sheets.writeRange', 'sheets.appendRows', 'sheets.updateCell', 'sheets.insertRows', 'sheets.batchUpdate',
  'roleplay_setting.list', 'roleplay_setting.inspect', 'roleplay_setting.create', 'roleplay_setting.update', 'roleplay_setting.move', 'roleplay_setting.delete',
]);

export type GoogleToolName = z.infer<typeof googleToolNameSchema>;

export const googleToolCallSchema = z.object({
  tool: googleToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export type GoogleToolCall = z.infer<typeof googleToolCallSchema>;

export type GoogleToolRisk = 'read' | 'write' | 'destructive' | 'send';

export type GoogleToolExposure = 'gemini' | 'internal';

export interface GoogleToolDescriptor {
  readonly name: GoogleToolName;
  readonly risk: GoogleToolRisk;
  readonly capability: string;
  readonly description: string;
  readonly exposure: GoogleToolExposure;
}
