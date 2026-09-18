import { GoogleCalendarService, type CalendarSendUpdates } from '../calendar/service';
import { GoogleChatService } from '../chat/service';
import { GoogleDocsService } from '../docs/service';
import { GoogleDriveService } from '../drive/service';
import { runGmailSendOnce } from '../gmail/send-replay';
import { GoogleGmailSemanticService, type GmailTurnGuard } from '../gmail/semantic-service';
import { googleOAuthAuthority } from '../oauth/authority';
import { GoogleSheetsService } from '../sheets/service';
import { runTaskCreateOnce } from '../tasks/create-replay';
import { GoogleTasksService, type GoogleTaskStatus } from '../tasks/service';
import type { GoogleToolHandlers } from './executor';
import type { GmailOrganizeAction } from './gmail-schemas';
import { googleReadToolHandlers } from './read-handlers';

const calendar = new GoogleCalendarService(googleOAuthAuthority);
const chat = new GoogleChatService(googleOAuthAuthority);
const docs = new GoogleDocsService(googleOAuthAuthority);
const drive = new GoogleDriveService(googleOAuthAuthority);
const gmail = new GoogleGmailSemanticService(googleOAuthAuthority);
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
function calendarSendUpdates(args: Record<string, unknown>): CalendarSendUpdates | undefined {
  const value = args.sendUpdates;
  if (value === undefined) return undefined;
  if (value !== 'all' && value !== 'externalOnly') throw new Error('Google Calendar sendUpdates must be all or externalOnly.');
  return value;
}
function taskStatus(args: Record<string, unknown>): GoogleTaskStatus | undefined {
  const value = args.status;
  if (value === undefined) return undefined;
  if (value !== 'needsAction' && value !== 'completed') throw new Error('Google Tasks status must be needsAction or completed.');
  return value;
}
function gmailAction(args: Record<string, unknown>): GmailOrganizeAction {
  const value = stringArg(args, 'action')!;
  if (!['archive', 'moveToInbox', 'markRead', 'markUnread', 'markSpam', 'markNotSpam', 'star', 'unstar', 'applyLabel', 'removeLabel'].includes(value)) throw new Error('Unsupported Gmail organize action.');
  return value as GmailOrganizeAction;
}
function gmailTurnGuard(signal: AbortSignal | undefined, isGenerationActive: (() => boolean) | undefined): GmailTurnGuard {
  return {
    ...(signal ? { signal } : {}),
    ...(isGenerationActive ? { isGenerationActive } : {}),
  };
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

  'calendar.createEvent': async ({ arguments: raw, callId }) => {
    const args = objectArgs(raw);
    const attendees = stringArrayArg(args, 'attendees');
    const recurrence = stringArrayArg(args, 'recurrence');
    return calendar.createSemanticEvent({
      calendarId: stringArg(args, 'calendarId', false),
      summary: stringArg(args, 'summary')!,
      start: stringArg(args, 'start')!,
      end: stringArg(args, 'end')!,
      timeZone: stringArg(args, 'timeZone', false),
      location: stringArg(args, 'location', false),
      description: stringArg(args, 'description', false),
      ...(attendees ? { attendees } : {}),
      ...(recurrence ? { recurrence } : {}),
      sendUpdates: calendarSendUpdates(args),
      ...(callId ? { idempotencyKey: callId } : {}),
    });
  },
  'calendar.updateEvent': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const attendees = stringArrayArg(args, 'attendees');
    const recurrence = stringArrayArg(args, 'recurrence');
    return calendar.updateSemanticEvent({
      calendarId: stringArg(args, 'calendarId', false),
      eventId: stringArg(args, 'eventId')!,
      etag: stringArg(args, 'etag')!,
      summary: stringArg(args, 'summary', false),
      start: stringArg(args, 'start', false),
      end: stringArg(args, 'end', false),
      timeZone: stringArg(args, 'timeZone', false),
      location: stringArg(args, 'location', false),
      description: stringArg(args, 'description', false),
      ...(attendees ? { attendees } : {}),
      ...(recurrence ? { recurrence } : {}),
      sendUpdates: calendarSendUpdates(args),
    });
  },
  'calendar.deleteEvent': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return calendar.deleteEvent(
      stringArg(args, 'calendarId', false),
      stringArg(args, 'eventId')!,
      stringArg(args, 'etag')!,
      calendarSendUpdates(args),
    );
  },

  'tasks.createTaskList': async ({ arguments: raw, callId, conversationId, messageId, generationId }) => {
    const title = stringArg(objectArgs(raw), 'title')!;
    const payload = { title };
    return runTaskCreateOnce(
      { tool: 'tasks.createTaskList', callId, conversationId, messageId, generationId },
      payload,
      () => tasks.createTaskList(title),
    );
  },
  'tasks.updateTaskList': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.updateTaskList(stringArg(args, 'taskListId')!, stringArg(args, 'title')!);
  },
  'tasks.deleteTaskList': async ({ arguments: raw }) => tasks.deleteTaskList(stringArg(objectArgs(raw), 'taskListId')!),
  'tasks.createTask': async ({ arguments: raw, callId, conversationId, messageId, generationId }) => {
    const args = objectArgs(raw);
    const input = {
      taskListId: stringArg(args, 'taskListId')!,
      title: stringArg(args, 'title')!,
      notes: stringArg(args, 'notes', false),
      scheduledDate: stringArg(args, 'scheduledDate', false),
      parent: stringArg(args, 'parent', false),
      previous: stringArg(args, 'previous', false),
    };
    return runTaskCreateOnce(
      { tool: 'tasks.createTask', callId, conversationId, messageId, generationId },
      input,
      () => tasks.createSemanticTask(input),
    );
  },
  'tasks.updateTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.updateSemanticTask({
      taskListId: stringArg(args, 'taskListId')!,
      taskId: stringArg(args, 'taskId')!,
      title: stringArg(args, 'title', false),
      notes: stringArg(args, 'notes', false),
      scheduledDate: stringArg(args, 'scheduledDate', false),
      clearScheduledDate: optionalBoolean(args, 'clearScheduledDate'),
      status: taskStatus(args),
    });
  },
  'tasks.moveTask': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return tasks.moveTask(
      stringArg(args, 'taskListId')!,
      stringArg(args, 'taskId')!,
      stringArg(args, 'parent', false),
      stringArg(args, 'previous', false),
      stringArg(args, 'destinationTaskListId', false),
    );
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

  'gmail.modifyMessage': async ({ arguments: raw, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    return gmail.organizeMessage(
      stringArg(args, 'messageId')!,
      gmailAction(args),
      stringArg(args, 'labelId', false),
      gmailTurnGuard(signal, isGenerationActive),
    );
  },
  'gmail.modifyThread': async ({ arguments: raw, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    return gmail.organizeThread(
      stringArg(args, 'threadId')!,
      gmailAction(args),
      stringArg(args, 'labelId', false),
      gmailTurnGuard(signal, isGenerationActive),
    );
  },
  'gmail.trashMessage': async ({ arguments: raw, signal, isGenerationActive }) => gmail.trashMessage(
    stringArg(objectArgs(raw), 'messageId')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.untrashMessage': async ({ arguments: raw, signal, isGenerationActive }) => gmail.untrashMessage(
    stringArg(objectArgs(raw), 'messageId')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.trashThread': async ({ arguments: raw, signal, isGenerationActive }) => gmail.trashThread(
    stringArg(objectArgs(raw), 'threadId')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.untrashThread': async ({ arguments: raw, signal, isGenerationActive }) => gmail.untrashThread(
    stringArg(objectArgs(raw), 'threadId')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.createLabel': async ({ arguments: raw, signal, isGenerationActive }) => gmail.createLabel(
    stringArg(objectArgs(raw), 'name')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.updateLabel': async ({ arguments: raw, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    return gmail.updateLabel(
      stringArg(args, 'labelId')!,
      stringArg(args, 'name')!,
      gmailTurnGuard(signal, isGenerationActive),
    );
  },
  'gmail.deleteLabel': async ({ arguments: raw, signal, isGenerationActive }) => gmail.deleteLabel(
    stringArg(objectArgs(raw), 'labelId')!,
    gmailTurnGuard(signal, isGenerationActive),
  ),
  'gmail.sendMessage': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    const payload = {
      to: stringArrayArg(args, 'to') ?? [],
      cc: stringArrayArg(args, 'cc'),
      subject: stringArg(args, 'subject')!,
      body: stringArg(args, 'body')!,
    };
    const guard = gmailTurnGuard(signal, isGenerationActive);
    return runGmailSendOnce(
      { tool: 'gmail.sendMessage', callId, conversationId, messageId, generationId, ...(signal ? { signal } : {}), ...(isGenerationActive ? { isGenerationActive } : {}) },
      payload,
      () => gmail.sendMessage(payload, guard),
    );
  },
  'gmail.replyMessage': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    const payload = {
      threadId: stringArg(args, 'threadId')!,
      to: stringArg(args, 'to')!,
      subject: stringArg(args, 'subject')!,
      body: stringArg(args, 'body')!,
      inReplyTo: stringArg(args, 'inReplyTo')!,
    };
    const guard = gmailTurnGuard(signal, isGenerationActive);
    return runGmailSendOnce(
      { tool: 'gmail.replyMessage', callId, conversationId, messageId, generationId, ...(signal ? { signal } : {}), ...(isGenerationActive ? { isGenerationActive } : {}) },
      payload,
      () => gmail.replyMessage(payload, guard),
    );
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
    const patch = recordArg(args, 'patch')!;
    const name = stringArg(patch, 'name', false);
    const description = stringArg(patch, 'description', false);
    const starred = optionalBoolean(patch, 'starred');
    return drive.updateFile(stringArg(args, 'fileId')!, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(starred !== undefined ? { starred } : {}),
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
  'sheets.updateCell': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.updateCell(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, args.value);
  },
  'sheets.insertRows': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const spreadsheetId = stringArg(args, 'spreadsheetId')!;
    const sheetId = optionalNumber(args, 'sheetId')!;
    const startIndex = optionalNumber(args, 'startIndex')!;
    const count = optionalNumber(args, 'count')!;
    await sheets.insertRows(spreadsheetId, sheetId, startIndex, count);
    return { inserted: true, spreadsheetId, sheetId, startIndex, count };
  },
  'sheets.batchUpdate': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return sheets.batchUpdate(stringArg(args, 'spreadsheetId')!, recordArrayArg(args, 'requests'));
  },
};
