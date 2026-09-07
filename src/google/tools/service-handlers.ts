import { GoogleCalendarService } from '../calendar/service';
import { GoogleChatService } from '../chat/service';
import { GoogleDocsService } from '../docs/service';
import { GoogleDriveService } from '../drive/service';
import { GoogleGmailService } from '../gmail/service';
import { googleOAuthAuthority } from '../oauth/authority';
import { GoogleSheetsService } from '../sheets/service';
import { GoogleTasksService } from '../tasks/service';
import type { GoogleToolHandlers } from './executor';
import { googleReadToolHandlers } from './read-handlers';

const calendar = new GoogleCalendarService(googleOAuthAuthority);
const chat = new GoogleChatService(googleOAuthAuthority);
const docs = new GoogleDocsService(googleOAuthAuthority);
const drive = new GoogleDriveService(googleOAuthAuthority);
const gmail = new GoogleGmailService(googleOAuthAuthority);
const sheets = new GoogleSheetsService(googleOAuthAuthority);
const tasks = new GoogleTasksService(googleOAuthAuthority);

function objectArgs(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...value };
}
function stringArg(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new Error(`Google tool argument ${key} must be a string.`);
  return value;
}
function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Google tool argument ${key} must be a boolean.`);
  return value;
}
function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new Error(`Google tool argument ${key} must be a number.`);
  return value;
}
function recordArg(args: Record<string, unknown>, key: string, required = true): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Google tool argument ${key} must be an object.`);
  return { ...(value as Record<string, unknown>) };
}
function stringArrayArg(args: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Google tool argument ${key} must be an array of strings.`);
  return value as string[];
}
function recordArrayArg(args: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`Google tool argument ${key} must be an array of objects.`);
  return value.map((item) => ({ ...(item as Record<string, unknown>) }));
}
function valuesArg(args: Record<string, unknown>): readonly (readonly unknown[])[] {
  const value = args.values;
  if (!Array.isArray(value) || value.some((row) => !Array.isArray(row))) throw new Error('Google Sheets values must be an array of rows.');
  return value as readonly (readonly unknown[])[];
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export const googleServiceToolHandlers: GoogleToolHandlers = {
  ...googleReadToolHandlers,

  'calendar.createEvent': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const attendees = stringArrayArg(args, 'attendees');
    return calendar.createSemanticEvent({
      calendarId: stringArg(args, 'calendarId', false),
      summary: stringArg(args, 'summary')!,
      start: stringArg(args, 'start')!,
      end: stringArg(args, 'end')!,
      location: stringArg(args, 'location', false),
      description: stringArg(args, 'description', false),
      ...(attendees ? { attendees } : {}),
    });
  },

  'tasks.createTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.createTask(stringArg(args, 'taskListId')!, recordArg(args, 'task')!, stringArg(args, 'parent', false), stringArg(args, 'previous', false));
  },
  'tasks.updateTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.updateTask(stringArg(args, 'taskListId')!, stringArg(args, 'taskId')!, recordArg(args, 'task')!);
  },
  'tasks.moveTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.moveTask(stringArg(args, 'taskListId')!, stringArg(args, 'taskId')!, stringArg(args, 'parent', false), stringArg(args, 'previous', false));
  },
  'tasks.deleteTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.deleteTask(stringArg(args, 'taskListId')!, stringArg(args, 'taskId')!);
  },
  'tasks.clearCompleted': async ({ arguments: raw }) => tasks.clearCompleted(stringArg(objectArgs(raw), 'taskListId')!),

  'docs.getDocument': async ({ arguments: raw }) => docs.getDocument(stringArg(objectArgs(raw), 'documentId')!),
  'docs.inspectDocument': async ({ arguments: raw }) => docs.inspectDocument(stringArg(objectArgs(raw), 'documentId')!),
  'docs.createDocument': async ({ arguments: raw }) => docs.createDocument(stringArg(objectArgs(raw), 'title')!),
  'docs.insertText': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return docs.insertText(stringArg(args, 'documentId')!, optionalNumber(args, 'index') ?? 1, stringArg(args, 'text')!);
  },
  'docs.appendParagraph': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return docs.appendParagraph(stringArg(args, 'documentId')!, stringArg(args, 'text')!);
  },
  'docs.replaceText': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return docs.replaceText(stringArg(args, 'documentId')!, stringArg(args, 'findText')!, stringArg(args, 'replaceText')!, optionalBoolean(args, 'matchCase') ?? false);
  },
  'docs.batchUpdate': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return docs.batchUpdate(stringArg(args, 'documentId')!, recordArrayArg(args, 'requests'), recordArg(args, 'writeControl', false));
  },

  'chat.listMessages': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return chat.listMessages(stringArg(args, 'spaceName')!, optionalNumber(args, 'pageSize'), stringArg(args, 'pageToken', false), stringArg(args, 'filter', false));
  },
  'chat.getMessage': async ({ arguments: raw }) => chat.getMessage(stringArg(objectArgs(raw), 'messageName')!),
  'chat.createMessage': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return chat.createMessage(stringArg(args, 'spaceName')!, recordArg(args, 'message')!, stringArg(args, 'requestId', false));
  },
  'chat.updateMessage': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return chat.updateMessage(stringArg(args, 'messageName')!, recordArg(args, 'message')!, stringArg(args, 'updateMask')!);
  },
  'chat.deleteMessage': async ({ arguments: raw }) => chat.deleteMessage(stringArg(objectArgs(raw), 'messageName')!),

  'gmail.modifyMessage': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return gmail.modifyMessage(stringArg(args, 'messageId')!, stringArrayArg(args, 'addLabelIds') ?? [], stringArrayArg(args, 'removeLabelIds') ?? []);
  },
  'gmail.modifyThread': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return gmail.modifyThread(stringArg(args, 'threadId')!, stringArrayArg(args, 'addLabelIds') ?? [], stringArrayArg(args, 'removeLabelIds') ?? []);
  },
  'gmail.trashMessage': async ({ arguments: raw }) => gmail.trashMessage(stringArg(objectArgs(raw), 'messageId')!),
  'gmail.untrashMessage': async ({ arguments: raw }) => gmail.untrashMessage(stringArg(objectArgs(raw), 'messageId')!),
  'gmail.trashThread': async ({ arguments: raw }) => gmail.trashThread(stringArg(objectArgs(raw), 'threadId')!),
  'gmail.untrashThread': async ({ arguments: raw }) => gmail.untrashThread(stringArg(objectArgs(raw), 'threadId')!),
  'gmail.createLabel': async ({ arguments: raw }) => gmail.createLabel(recordArg(objectArgs(raw), 'label')!),
  'gmail.updateLabel': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return gmail.updateLabel(stringArg(args, 'labelId')!, recordArg(args, 'label')!);
  },
  'gmail.deleteLabel': async ({ arguments: raw }) => gmail.deleteLabel(stringArg(objectArgs(raw), 'labelId')!),
  'gmail.sendMessage': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return gmail.sendComposedMessage({
      to: stringArrayArg(args, 'to') ?? [],
      cc: stringArrayArg(args, 'cc'),
      subject: stringArg(args, 'subject')!,
      body: stringArg(args, 'body')!,
      threadId: stringArg(args, 'threadId', false),
    });
  },

  'drive.searchFiles': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return drive.listFiles({ query: stringArg(args, 'query', false), pageToken: stringArg(args, 'pageToken', false), pageSize: optionalNumber(args, 'pageSize') });
  },
  'drive.searchLibrary': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return drive.searchLibrary({ query: stringArg(args, 'query', false), pageToken: stringArg(args, 'pageToken', false), pageSize: optionalNumber(args, 'pageSize') });
  },
  'drive.getFile': async ({ arguments: raw }) => drive.getFile(stringArg(objectArgs(raw), 'fileId')!),
  'drive.downloadFile': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const result = await drive.downloadFile(stringArg(args, 'fileId')!, optionalNumber(args, 'maxBytes'));
    return { mimeType: result.mimeType, bytesBase64: bytesToBase64(result.bytes) };
  },
  'drive.createFile': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const parents = stringArrayArg(args, 'parents');
    const mimeType = stringArg(args, 'mimeType', false);
    return drive.createFile({ name: stringArg(args, 'name')!, ...(mimeType !== undefined ? { mimeType } : {}), ...(parents ? { parents } : {}) });
  },
  'drive.updateFile': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const name = stringArg(args, 'name', false);
    const description = stringArg(args, 'description', false);
    const starred = optionalBoolean(args, 'starred');
    const trashed = optionalBoolean(args, 'trashed');
    return drive.updateFile(stringArg(args, 'fileId')!, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(starred !== undefined ? { starred } : {}),
      ...(trashed !== undefined ? { trashed } : {}),
    });
  },
  'drive.moveFile': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return drive.moveFile(stringArg(args, 'fileId')!, stringArg(args, 'parentId')!, stringArg(args, 'previousParentId', false));
  },

  'sheets.getSpreadsheet': async ({ arguments: raw }) => sheets.getSpreadsheet(stringArg(objectArgs(raw), 'spreadsheetId')!),
  'sheets.readRange': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.readRange(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!);
  },
  'sheets.writeRange': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.writeRange(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, valuesArg(args));
  },
  'sheets.appendRows': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.appendRows(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, valuesArg(args));
  },
  'sheets.batchUpdate': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.batchUpdate(stringArg(args, 'spreadsheetId')!, recordArrayArg(args, 'requests'));
  },
};
