import { GoogleCalendarService, type CalendarSendUpdates } from '../calendar/service';
import { GoogleChatService } from '../chat/service';
import { GoogleDocsService } from '../docs/service';
import { runDriveCreateOnce } from '../drive/create-replay';
import { downloadDriveFileArtifact } from '../drive/download';
import { GoogleDriveService } from '../drive/service';
import { runGmailSendOnce } from '../gmail/send-replay';
import { GoogleGmailSemanticService, type GmailTurnGuard } from '../gmail/semantic-service';
import { googleOAuthAuthority } from '../oauth/authority';
import type { GoogleExecutionGrant } from '../oauth/contracts';
import { GoogleSheetsService, type GoogleSheetInputMode } from '../sheets/service';
import { runTaskCreateOnce } from '../tasks/create-replay';
import { assertGooglePickerFileAllowed, filterRevokedGooglePickerFiles } from '../../persistence/google-picker-admissions';
import { GoogleTasksService, type GoogleTaskStatus } from '../tasks/service';
import type { GoogleToolHandlers } from './executor';
import type { GmailOrganizeAction } from './gmail-schemas';
import { googleReadToolHandlers } from './read-handlers';
import { runWorkspaceCreateOnce } from './workspace-create-replay';
import { saveGoogleWorkspaceExportArtifact } from './workspace-export-artifact';

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
function sheetsInputMode(args: Record<string, unknown>): GoogleSheetInputMode {
  const value = args.inputMode;
  if (value === undefined) return 'literal';
  if (value !== 'literal' && value !== 'userEntered') throw new Error('Google Sheets inputMode must be literal or userEntered.');
  return value;
}
function approvedGoogleGrantGuard(grant: GoogleExecutionGrant | undefined): (() => Promise<void>) | undefined {
  if (!grant || !googleOAuthAuthority.assertExecutionGrant) return undefined;
  return () => googleOAuthAuthority.assertExecutionGrant!(grant);
}
function mutationGuard(
  signal: AbortSignal | undefined,
  isGenerationActive: (() => boolean) | undefined,
  googleExecutionGrant?: GoogleExecutionGrant,
) {
  const beforeProviderFetch = approvedGoogleGrantGuard(googleExecutionGrant);
  return {
    ...(signal ? { signal } : {}),
    ...(isGenerationActive ? { isGenerationActive } : {}),
    ...(beforeProviderFetch ? { beforeProviderFetch } : {}),
  };
}
function gmailTurnGuard(
  signal: AbortSignal | undefined,
  isGenerationActive: (() => boolean) | undefined,
  googleExecutionGrant?: GoogleExecutionGrant,
): GmailTurnGuard {
  const beforeProviderFetch = approvedGoogleGrantGuard(googleExecutionGrant);
  return {
    ...(signal ? { signal } : {}),
    ...(isGenerationActive ? { isGenerationActive } : {}),
    ...(beforeProviderFetch ? { beforeProviderFetch } : {}),
  };
}
export const googleServiceToolHandlers: GoogleToolHandlers = {
  ...googleReadToolHandlers,

  'calendar.createEvent': async ({ arguments: raw, callId, signal, isGenerationActive, googleExecutionGrant }) => {
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
    }, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'calendar.updateEvent': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
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
    }, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'calendar.deleteEvent': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return calendar.deleteEvent(
      stringArg(args, 'calendarId', false),
      stringArg(args, 'eventId')!,
      stringArg(args, 'etag')!,
      calendarSendUpdates(args),
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },

  'tasks.createTaskList': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const title = stringArg(objectArgs(raw), 'title')!;
    const payload = { title };
    return runTaskCreateOnce(
      { tool: 'tasks.createTaskList', callId, conversationId, messageId, generationId },
      payload,
      () => tasks.createTaskList(title, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),
    );
  },
  'tasks.updateTaskList': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return tasks.updateTaskList(stringArg(args, 'taskListId')!, stringArg(args, 'title')!, undefined, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'tasks.deleteTaskList': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => tasks.deleteTaskList(stringArg(objectArgs(raw), 'taskListId')!, undefined, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),
  'tasks.createTask': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
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
      () => tasks.createSemanticTask(input, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),
    );
  },
  'tasks.updateTask': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return tasks.updateSemanticTask({
      etag: stringArg(args, 'etag', false),
      taskListId: stringArg(args, 'taskListId')!,
      taskId: stringArg(args, 'taskId')!,
      title: stringArg(args, 'title', false),
      notes: stringArg(args, 'notes', false),
      scheduledDate: stringArg(args, 'scheduledDate', false),
      clearScheduledDate: optionalBoolean(args, 'clearScheduledDate'),
      status: taskStatus(args),
    }, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'tasks.moveTask': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return tasks.moveTask(
      stringArg(args, 'taskListId')!,
      stringArg(args, 'taskId')!,
      stringArg(args, 'parent', false),
      stringArg(args, 'previous', false),
      stringArg(args, 'destinationTaskListId', false),
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'tasks.deleteTask': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return tasks.deleteTask(stringArg(args, 'taskListId')!, stringArg(args, 'taskId')!, undefined, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'tasks.clearCompleted': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => tasks.clearCompleted(stringArg(objectArgs(raw), 'taskListId')!, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),

  'docs.getDocument': async ({ arguments: raw }) => {
    const documentId = stringArg(objectArgs(raw), 'documentId')!;
    await assertGooglePickerFileAllowed(documentId);
    return docs.getDocument(documentId);
  },
  'docs.inspectDocument': async ({ arguments: raw }) => {
    const documentId = stringArg(objectArgs(raw), 'documentId')!;
    await assertGooglePickerFileAllowed(documentId);
    return docs.inspectDocument(documentId);
  },
  'docs.exportDocument': async ({ arguments: raw, conversationId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    const documentId = stringArg(args, 'documentId')!;
    await assertGooglePickerFileAllowed(documentId);
    const inspected = await docs.inspectDocument(documentId);
    const format = stringArg(args, 'format') as 'pdf' | 'docx';
    const maxBytes = optionalNumber(args, 'maxBytes');
    const guard = mutationGuard(signal, isGenerationActive, googleExecutionGrant);
    return saveGoogleWorkspaceExportArtifact({
      fileId: documentId,
      baseName: inspected.title,
      conversationId,
      generationId,
      signal,
      isGenerationActive,
      exportContent: async () => {
        const exported = await docs.exportDocument(documentId, format, { ...guard, ...(maxBytes !== undefined ? { maxBytes } : {}) });
        return exported;
      },
    });
  },
  'docs.createDocument': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const title = stringArg(objectArgs(raw), 'title')!;
    const payload = { title };
    const guard = mutationGuard(signal, isGenerationActive, googleExecutionGrant);
    return runWorkspaceCreateOnce(
      { tool: 'docs.createDocument', callId, conversationId, messageId, generationId, ...guard },
      payload,
      () => docs.createDocument(title, guard),
    );
  },
  'docs.insertText': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'documentId')!);
    return docs.insertText(
      stringArg(args, 'documentId')!,
      stringArg(args, 'tabId')!,
      stringArg(args, 'revisionId')!,
      optionalNumber(args, 'index') ?? 1,
      stringArg(args, 'text')!,
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'docs.appendParagraph': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'documentId')!);
    return docs.appendParagraph(
      stringArg(args, 'documentId')!,
      stringArg(args, 'tabId')!,
      stringArg(args, 'revisionId')!,
      stringArg(args, 'text')!,
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'docs.replaceText': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'documentId')!);
    return docs.replaceText(
      stringArg(args, 'documentId')!,
      stringArg(args, 'tabId')!,
      stringArg(args, 'revisionId')!,
      stringArg(args, 'findText')!,
      stringArg(args, 'replaceText')!,
      optionalBoolean(args, 'matchCase') ?? false,
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'docs.batchUpdate': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'documentId')!);
    return docs.batchUpdate(stringArg(args, 'documentId')!, recordArrayArg(args, 'requests'), recordArg(args, 'writeControl', false), mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },

  'chat.listMessages': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    return chat.listMessages(stringArg(args, 'spaceName')!, optionalNumber(args, 'pageSize'), stringArg(args, 'pageToken', false), stringArg(args, 'filter', false));
  },
  'chat.getMessage': async ({ arguments: raw }) => chat.getMessage(stringArg(objectArgs(raw), 'messageName')!),
  'chat.createMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return chat.createMessage(
      stringArg(args, 'spaceName')!,
      recordArg(args, 'message')!,
      stringArg(args, 'requestId', false),
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'chat.updateMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return chat.updateMessage(stringArg(args, 'messageName')!, recordArg(args, 'message')!, stringArg(args, 'updateMask')!, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'chat.deleteMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => chat.deleteMessage(stringArg(objectArgs(raw), 'messageName')!, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),

  'gmail.modifyMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return gmail.organizeMessage(
      stringArg(args, 'messageId')!,
      gmailAction(args),
      stringArg(args, 'labelId', false),
      gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'gmail.modifyThread': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return gmail.organizeThread(
      stringArg(args, 'threadId')!,
      gmailAction(args),
      stringArg(args, 'labelId', false),
      gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'gmail.trashMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.trashMessage(
    stringArg(objectArgs(raw), 'messageId')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.untrashMessage': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.untrashMessage(
    stringArg(objectArgs(raw), 'messageId')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.trashThread': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.trashThread(
    stringArg(objectArgs(raw), 'threadId')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.untrashThread': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.untrashThread(
    stringArg(objectArgs(raw), 'threadId')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.createLabel': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.createLabel(
    stringArg(objectArgs(raw), 'name')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.updateLabel': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    return gmail.updateLabel(
      stringArg(args, 'labelId')!,
      stringArg(args, 'name')!,
      gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'gmail.deleteLabel': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => gmail.deleteLabel(
    stringArg(objectArgs(raw), 'labelId')!,
    gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant),
  ),
  'gmail.sendMessage': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    const payload = {
      to: stringArrayArg(args, 'to') ?? [],
      cc: stringArrayArg(args, 'cc'),
      subject: stringArg(args, 'subject')!,
      body: stringArg(args, 'body')!,
    };
    const guard = gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant);
    return runGmailSendOnce(
      { tool: 'gmail.sendMessage', callId, conversationId, messageId, generationId, ...(signal ? { signal } : {}), ...(isGenerationActive ? { isGenerationActive } : {}) },
      payload,
      () => gmail.sendMessage(payload, guard),
    );
  },
  'gmail.replyMessage': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    const payload = {
      threadId: stringArg(args, 'threadId')!,
      to: stringArg(args, 'to')!,
      subject: stringArg(args, 'subject')!,
      body: stringArg(args, 'body')!,
      inReplyTo: stringArg(args, 'inReplyTo')!,
    };
    const guard = gmailTurnGuard(signal, isGenerationActive, googleExecutionGrant);
    return runGmailSendOnce(
      { tool: 'gmail.replyMessage', callId, conversationId, messageId, generationId, ...(signal ? { signal } : {}), ...(isGenerationActive ? { isGenerationActive } : {}) },
      payload,
      () => gmail.replyMessage(payload, guard),
    );
  },

  'drive.searchFiles': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const result = await drive.listFiles({
      query: stringArg(args, 'query', false),
      pageToken: stringArg(args, 'pageToken', false),
      pageSize: optionalNumber(args, 'pageSize'),
      showTrashed: optionalBoolean(args, 'showTrashed'),
    });
    return { ...result, files: await filterRevokedGooglePickerFiles(result.files) };
  },
  'drive.searchLibrary': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    const result = await drive.searchLibrary({
      query: stringArg(args, 'query', false),
      pageToken: stringArg(args, 'pageToken', false),
      pageSize: optionalNumber(args, 'pageSize'),
      showTrashed: optionalBoolean(args, 'showTrashed'),
    });
    return { ...result, files: await filterRevokedGooglePickerFiles(result.files) };
  },
  'drive.getFile': async ({ arguments: raw }) => {
    const fileId = stringArg(objectArgs(raw), 'fileId')!;
    await assertGooglePickerFileAllowed(fileId);
    return drive.getFile(fileId);
  },
  'drive.downloadFile': async ({ arguments: raw, signal, generationId, isGenerationActive, conversationId }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'fileId')!);
    return downloadDriveFileArtifact({
      fileId: stringArg(args, 'fileId')!,
      maxBytes: optionalNumber(args, 'maxBytes'),
      conversationId,
      signal,
      generationId,
      isGenerationActive,
    });
  },
  'drive.createFile': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    const parents = stringArrayArg(args, 'parents');
    const mimeType = stringArg(args, 'mimeType', false);
    const input = { name: stringArg(args, 'name')!, ...(mimeType !== undefined ? { mimeType } : {}), ...(parents ? { parents } : {}) };
    // Keyed by (name, mimeType, parents) per call id: a replayed call returns
    // the first result instead of creating a second file, and a replayed call
    // id with different arguments fails closed.
    return runDriveCreateOnce(
      { tool: 'drive.createFile', callId, conversationId, messageId, generationId, ...(signal ? { signal } : {}), ...(isGenerationActive ? { isGenerationActive } : {}) },
      input,
      () => drive.createFile(input, mutationGuard(signal, isGenerationActive, googleExecutionGrant)),
    );
  },
  'drive.updateFile': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'fileId')!);
    const patch = recordArg(args, 'patch')!;
    const name = stringArg(patch, 'name', false);
    const description = stringArg(patch, 'description', false);
    const starred = optionalBoolean(patch, 'starred');
    return drive.updateFile(stringArg(args, 'fileId')!, stringArg(args, 'etag')!, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(starred !== undefined ? { starred } : {}),
    }, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'drive.moveFile': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'fileId')!);
    return drive.moveFile(
      stringArg(args, 'fileId')!,
      stringArg(args, 'etag')!,
      stringArg(args, 'parentId')!,
      stringArg(args, 'previousParentId', false),
      mutationGuard(signal, isGenerationActive, googleExecutionGrant),
    );
  },
  'drive.trashFile': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'fileId')!);
    return drive.trashFile(stringArg(args, 'fileId')!, stringArg(args, 'etag')!, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },

  'sheets.getSpreadsheet': async ({ arguments: raw }) => {
    const spreadsheetId = stringArg(objectArgs(raw), 'spreadsheetId')!;
    await assertGooglePickerFileAllowed(spreadsheetId);
    return sheets.getSpreadsheet(spreadsheetId);
  },
  'sheets.readRange': async ({ arguments: raw }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    return sheets.readRange(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!);
  },
  'sheets.exportSpreadsheet': async ({ arguments: raw, conversationId, generationId, signal, isGenerationActive }) => {
    const args = objectArgs(raw);
    const spreadsheetId = stringArg(args, 'spreadsheetId')!;
    await assertGooglePickerFileAllowed(spreadsheetId);
    const inspected = await sheets.getSpreadsheet(spreadsheetId);
    const format = stringArg(args, 'format') as 'pdf' | 'xlsx';
    const maxBytes = optionalNumber(args, 'maxBytes');
    const guard = mutationGuard(signal, isGenerationActive, googleExecutionGrant);
    return saveGoogleWorkspaceExportArtifact({
      fileId: spreadsheetId,
      baseName: inspected.title,
      conversationId,
      generationId,
      signal,
      isGenerationActive,
      exportContent: async () => {
        const exported = await sheets.exportSpreadsheet(spreadsheetId, format, { ...guard, ...(maxBytes !== undefined ? { maxBytes } : {}) });
        return exported;
      },
    });
  },
  'sheets.createSpreadsheet': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    const title = stringArg(args, 'title')!;
    const firstSheetTitle = stringArg(args, 'firstSheetTitle', false);
    const payload = { title, ...(firstSheetTitle ? { firstSheetTitle } : {}) };
    const guard = mutationGuard(signal, isGenerationActive, googleExecutionGrant);
    return runWorkspaceCreateOnce(
      { tool: 'sheets.createSpreadsheet', callId, conversationId, messageId, generationId, ...guard },
      payload,
      () => sheets.createSpreadsheet(title, firstSheetTitle, guard),
    );
  },
  'sheets.addSheet': async ({ arguments: raw, callId, conversationId, messageId, generationId, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    const spreadsheetId = stringArg(args, 'spreadsheetId')!;
    const title = stringArg(args, 'title')!;
    const rowCount = optionalNumber(args, 'rowCount') ?? 1000;
    const columnCount = optionalNumber(args, 'columnCount') ?? 26;
    const payload = { spreadsheetId, title, rowCount, columnCount };
    const guard = mutationGuard(signal, isGenerationActive, googleExecutionGrant);
    return runWorkspaceCreateOnce(
      { tool: 'sheets.addSheet', callId, conversationId, messageId, generationId, ...guard },
      payload,
      () => sheets.addSheet(spreadsheetId, title, rowCount, columnCount, guard),
    );
  },
  'sheets.writeRange': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    return sheets.writeRange(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, valuesArg(args), sheetsInputMode(args), mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'sheets.appendRows': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    return sheets.appendRows(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, valuesArg(args), sheetsInputMode(args), mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'sheets.updateCell': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    return sheets.updateCell(stringArg(args, 'spreadsheetId')!, stringArg(args, 'range')!, args.value, sheetsInputMode(args), mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
  'sheets.insertRows': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    const spreadsheetId = stringArg(args, 'spreadsheetId')!;
    const sheetId = optionalNumber(args, 'sheetId')!;
    const startIndex = optionalNumber(args, 'startIndex')!;
    const count = optionalNumber(args, 'count')!;
    await sheets.insertRows(spreadsheetId, sheetId, startIndex, count, mutationGuard(signal, isGenerationActive, googleExecutionGrant));
    return { inserted: true, spreadsheetId, sheetId, startIndex, count };
  },
  'sheets.batchUpdate': async ({ arguments: raw, signal, isGenerationActive, googleExecutionGrant }) => {
    const args = objectArgs(raw);
    await assertGooglePickerFileAllowed(stringArg(args, 'spreadsheetId')!);
    return sheets.batchUpdate(stringArg(args, 'spreadsheetId')!, recordArrayArg(args, 'requests'), mutationGuard(signal, isGenerationActive, googleExecutionGrant));
  },
};
