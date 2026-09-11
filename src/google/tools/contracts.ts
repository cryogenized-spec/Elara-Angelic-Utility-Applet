import { z } from 'zod';

export const googleToolNameSchema = z.enum([
  'calendar.listEvents', 'calendar.createEvent',
  'tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask', 'tasks.createTask', 'tasks.updateTask', 'tasks.moveTask', 'tasks.deleteTask', 'tasks.clearCompleted',
  'docs.getDocument', 'docs.inspectDocument', 'docs.createDocument', 'docs.insertText', 'docs.appendParagraph', 'docs.replaceText', 'docs.batchUpdate',
  'document.create_pdf',
  'chat.listMessages', 'chat.getMessage', 'chat.createMessage', 'chat.updateMessage', 'chat.deleteMessage',
  'gmail.listMessages', 'gmail.getMessage', 'gmail.listThreads', 'gmail.getThread', 'gmail.listLabels', 'gmail.getLabel', 'gmail.modifyMessage', 'gmail.modifyThread', 'gmail.trashMessage', 'gmail.untrashMessage', 'gmail.trashThread', 'gmail.untrashThread', 'gmail.createLabel', 'gmail.updateLabel', 'gmail.deleteLabel', 'gmail.sendMessage',
  'drive.searchFiles', 'drive.searchLibrary', 'drive.getFile', 'drive.downloadFile', 'drive.createFile', 'drive.updateFile', 'drive.moveFile',
  'sheets.getSpreadsheet', 'sheets.readRange', 'sheets.writeRange', 'sheets.appendRows', 'sheets.updateCell', 'sheets.insertRows', 'sheets.batchUpdate',
  'roleplay_setting.list', 'roleplay_setting.inspect', 'roleplay_setting.create', 'roleplay_setting.update', 'roleplay_setting.move', 'roleplay_setting.delete',
  'youtube.search',
]);

export type GoogleToolName = z.infer<typeof googleToolNameSchema>;

export const googleToolCallSchema = z.object({
  tool: googleToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});

export type GoogleToolCall = z.infer<typeof googleToolCallSchema>;

export type GoogleToolRisk = 'read' | 'write' | 'destructive' | 'send';

export type GoogleToolExposure = 'gemini' | 'internal';

/**
 * Where a tool can actually be executed.
 *
 * Both the browser tool loop and the Cloudflare Worker build their Gemini
 * function list from the one central registry, but only the browser has tool
 * handlers. Without this field the Worker advertises tools it cannot run, and
 * the model calls them into a dead end. Omitted means "runs anywhere", which is
 * the case for every OAuth-backed tool the Worker proxies.
 */
export type GoogleToolExecutionPlane = 'browser' | 'worker';

export interface GoogleToolDescriptor {
  readonly name: GoogleToolName;
  readonly risk: GoogleToolRisk;
  readonly capability: string;
  readonly description: string;
  readonly exposure: GoogleToolExposure;
  readonly executionPlane?: GoogleToolExecutionPlane;
}
