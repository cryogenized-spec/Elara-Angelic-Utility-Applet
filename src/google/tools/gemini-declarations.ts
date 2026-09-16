import { googleToolRegistry, googleToolsForPlane } from './registry';
import type { GoogleToolDescriptor, GoogleToolExecutionPlane } from './contracts';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../../domain/media';

export interface GeminiFunctionDeclaration { readonly type: 'function'; readonly name: string; readonly description: string; readonly parameters: { readonly type: 'object'; readonly properties: Record<string, unknown>; readonly additionalProperties: boolean; readonly required?: readonly string[]; }; }

const stringProperty = (description: string) => ({ type: 'string', description });
const objectProperty = (description: string) => ({ type: 'object', description });
const arrayProperty = (description: string, items: Record<string, unknown> = { type: 'string' }) => ({ type: 'array', items, description });
const calendarSendUpdatesProperty = { type: 'string', enum: ['all', 'externalOnly'], description: 'Optional guest-notification policy. Omit when notifications are not requested.' };

const toolProperties: Record<string, Record<string, unknown>> = {
  'calendar.listCalendars': { pageToken: stringProperty('Optional pagination token.'), maxResults: { type: 'integer', minimum: 1, maximum: 250 }, showHidden: { type: 'boolean', description: 'Whether hidden calendars should be included.' }, minAccessRole: { type: 'string', enum: ['freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner'], description: 'Optional minimum access role.' }, showOwnOrganizationOnly: { type: 'boolean', description: 'When supported by the account, restrict results to calendars owned by the user organization.' } },
  'calendar.listEvents': { calendarId: stringProperty('Optional calendar id; defaults to primary.'), timeMin: stringProperty('Optional RFC 3339 lower time bound.'), timeMax: stringProperty('Optional RFC 3339 upper time bound.'), pageToken: stringProperty('Optional pagination token.'), maxResults: { type: 'integer', minimum: 1, maximum: 250 }, query: stringProperty('Optional free-text event query.'), timeZone: stringProperty('Optional IANA timezone for returned event times.') },
  'calendar.getEvent': { calendarId: stringProperty('Optional calendar id; defaults to primary.'), eventId: stringProperty('Event id from a prior Calendar read.'), timeZone: stringProperty('Optional IANA timezone for returned event times.') },
  'calendar.getSettings': {},
  'calendar.queryFreeBusy': { timeMin: stringProperty('RFC 3339 start of the availability window.'), timeMax: stringProperty('RFC 3339 end of the availability window.'), calendarIds: arrayProperty('One to 50 calendar ids to check.'), timeZone: stringProperty('Optional IANA timezone for the response.') },
  'calendar.createEvent': { calendarId: stringProperty('Optional calendar id; defaults to primary.'), summary: stringProperty('Event title.'), start: stringProperty('Start as RFC 3339 date-time or all-day YYYY-MM-DD date.'), end: stringProperty('End as RFC 3339 date-time or all-day YYYY-MM-DD date.'), timeZone: stringProperty('IANA timezone. Required for recurring date-time events.'), location: stringProperty('Optional location.'), description: stringProperty('Optional description.'), attendees: arrayProperty('Optional attendee email addresses.'), recurrence: arrayProperty('Optional RFC 5545 recurrence lines beginning with RRULE:, EXRULE:, RDATE:, or EXDATE:.'), sendUpdates: calendarSendUpdatesProperty },
  'calendar.updateEvent': { calendarId: stringProperty('Optional calendar id; defaults to primary.'), eventId: stringProperty('Event id from calendar.getEvent.'), etag: stringProperty('Current ETag from calendar.getEvent. Re-read after a conflict.'), summary: stringProperty('Optional replacement event title; empty string clears it.'), start: stringProperty('Optional replacement RFC 3339 date-time or all-day date.'), end: stringProperty('Optional replacement RFC 3339 date-time or all-day date.'), timeZone: stringProperty('Optional IANA timezone used with replacement date-times.'), location: stringProperty('Optional replacement location; empty string clears it.'), description: stringProperty('Optional replacement description; empty string clears it.'), attendees: arrayProperty('Optional complete replacement attendee email list; an empty array clears attendees.'), recurrence: arrayProperty('Optional complete replacement recurrence list; an empty array clears recurrence.'), sendUpdates: calendarSendUpdatesProperty },
  'calendar.deleteEvent': { calendarId: stringProperty('Optional calendar id; defaults to primary.'), eventId: stringProperty('Event id from calendar.getEvent.'), etag: stringProperty('Current ETag from calendar.getEvent. Re-read after a conflict.'), sendUpdates: calendarSendUpdatesProperty },
  'tasks.listTaskLists': { pageToken: stringProperty('Optional pagination token.') },
  'tasks.listTasks': { taskListId: stringProperty('Task list id.'), pageToken: stringProperty('Optional pagination token.'), showCompleted: { type: 'boolean' }, showDeleted: { type: 'boolean' }, showHidden: { type: 'boolean' }, dueMin: stringProperty('Optional RFC 3339 lower due-time bound.'), dueMax: stringProperty('Optional RFC 3339 upper due-time bound.'), updatedMin: stringProperty('Optional RFC 3339 lower updated-time bound.'), completedMin: stringProperty('Optional RFC 3339 lower completed-time bound.'), completedMax: stringProperty('Optional RFC 3339 upper completed-time bound.'), maxResults: { type: 'integer', minimum: 1, maximum: 100 } },
  'tasks.getTask': { taskListId: stringProperty('Task list id.'), taskId: stringProperty('Task id.') },
  'tasks.createTask': { taskListId: stringProperty('Task list id.'), task: objectProperty('Google Tasks task resource to create.'), parent: stringProperty('Optional parent task id.'), previous: stringProperty('Optional sibling task id to insert after.') },
  'tasks.updateTask': { taskListId: stringProperty('Task list id.'), taskId: stringProperty('Task id.'), task: objectProperty('Complete task resource replacement.') },
  'tasks.moveTask': { taskListId: stringProperty('Task list id.'), taskId: stringProperty('Task id.'), parent: stringProperty('Optional parent task id.'), previous: stringProperty('Optional sibling task id.') },
  'tasks.deleteTask': { taskListId: stringProperty('Task list id.'), taskId: stringProperty('Task id.') },
  'tasks.clearCompleted': { taskListId: stringProperty('Task list id.') },
  'docs.getDocument': { documentId: stringProperty('Google Docs document id.') },
  'docs.inspectDocument': { documentId: stringProperty('Google Docs document id.') },
  'docs.createDocument': { title: stringProperty('New document title.') },
  'docs.insertText': { documentId: stringProperty('Google Docs document id.'), index: { type: 'integer', minimum: 1, description: 'Insert index from a prior inspect.' }, text: stringProperty('Text to insert.') },
  'docs.appendParagraph': { documentId: stringProperty('Google Docs document id.'), text: stringProperty('Paragraph text to append.') },
  'docs.replaceText': { documentId: stringProperty('Google Docs document id.'), findText: stringProperty('Text to find.'), replaceText: stringProperty('Replacement text.'), matchCase: { type: 'boolean' } },
  'docs.batchUpdate': { documentId: stringProperty('Google Docs document id.'), requests: arrayProperty('Explicit Google Docs batch update request objects.', objectProperty('A Google Docs batch update request.')), writeControl: objectProperty('Optional Google Docs write control.') },
  'document.create_pdf': { source: stringProperty('Validated LaTeX or document source.'), title: stringProperty('Optional document title.') },
  'chat.listMessages': { spaceName: stringProperty('Google Chat space resource name.'), pageSize: { type: 'integer', minimum: 1, maximum: 100 }, pageToken: stringProperty('Optional pagination token.'), filter: stringProperty('Optional Google Chat message filter.') },
  'chat.getMessage': { messageName: stringProperty('Google Chat message resource name.') },
  'chat.createMessage': { spaceName: stringProperty('Google Chat space resource name.'), message: objectProperty('Google Chat message resource.'), requestId: stringProperty('Optional idempotency request id.') },
  'chat.updateMessage': { messageName: stringProperty('Google Chat message resource name.'), message: objectProperty('Message fields to update.'), updateMask: stringProperty('Field mask identifying updated message fields.') },
  'chat.deleteMessage': { messageName: stringProperty('Google Chat message resource name.') },
  'gmail.listMessages': { query: stringProperty('Optional Gmail search query.'), pageToken: stringProperty('Optional pagination token.'), maxResults: { type: 'integer', minimum: 1, maximum: 100 }, includeSpamTrash: { type: 'boolean' } },
  'gmail.getMessage': { messageId: stringProperty('Gmail message id.'), format: { type: 'string', enum: ['minimal', 'full', 'metadata'] }, metadataHeaders: arrayProperty('Optional metadata headers to include.') },
  'gmail.listThreads': { query: stringProperty('Optional Gmail search query.'), pageToken: stringProperty('Optional pagination token.'), maxResults: { type: 'integer', minimum: 1, maximum: 100 }, includeSpamTrash: { type: 'boolean' } },
  'gmail.getThread': { threadId: stringProperty('Gmail thread id.'), format: { type: 'string', enum: ['minimal', 'full', 'metadata'] }, metadataHeaders: arrayProperty('Optional metadata headers to include.') },
  'gmail.listLabels': {},
  'gmail.getLabel': { labelId: stringProperty('Gmail label id.') },
  'gmail.modifyMessage': { messageId: stringProperty('Gmail message id.'), addLabelIds: arrayProperty('Label ids to add.'), removeLabelIds: arrayProperty('Label ids to remove.') },
  'gmail.modifyThread': { threadId: stringProperty('Gmail thread id.'), addLabelIds: arrayProperty('Label ids to add.'), removeLabelIds: arrayProperty('Label ids to remove.') },
  'gmail.trashMessage': { messageId: stringProperty('Gmail message id.') },
  'gmail.untrashMessage': { messageId: stringProperty('Gmail message id.') },
  'gmail.trashThread': { threadId: stringProperty('Gmail thread id.') },
  'gmail.untrashThread': { threadId: stringProperty('Gmail thread id.') },
  'gmail.createLabel': { label: objectProperty('Gmail label resource.') },
  'gmail.updateLabel': { labelId: stringProperty('Gmail label id.'), label: objectProperty('Updated Gmail label resource.') },
  'gmail.deleteLabel': { labelId: stringProperty('Gmail label id.') },
  'gmail.sendMessage': { to: arrayProperty('Recipient email addresses.'), cc: arrayProperty('Optional CC email addresses.'), subject: stringProperty('Email subject.'), body: stringProperty('Plain-text email body.'), threadId: stringProperty('Optional Gmail thread id for replies.') },
  'drive.searchFiles': { query: stringProperty('Optional Drive query expression.'), pageToken: stringProperty('Optional pagination token.'), pageSize: { type: 'integer', minimum: 1, maximum: 100 } },
  'drive.searchLibrary': { query: stringProperty('Optional Drive query expression for the broader library.'), pageToken: stringProperty('Optional pagination token.'), pageSize: { type: 'integer', minimum: 1, maximum: 100 } },
  'drive.getFile': { fileId: stringProperty('Drive file id.') },
  'drive.downloadFile': { fileId: stringProperty('Drive file id.') },
  'drive.createFile': { name: stringProperty('New file name.'), mimeType: stringProperty('Optional MIME type.'), parents: arrayProperty('Optional parent folder ids.') },
  'drive.updateFile': { fileId: stringProperty('Drive file id.'), patch: objectProperty('Explicit Drive metadata fields to update.') },
  'drive.moveFile': { fileId: stringProperty('Drive file id.'), parentId: stringProperty('Destination parent folder id.'), previousParentId: stringProperty('Optional previous parent folder id to remove.') },
  'sheets.getSpreadsheet': { spreadsheetId: stringProperty('Spreadsheet id.') },
  'sheets.readRange': { spreadsheetId: stringProperty('Spreadsheet id.'), range: stringProperty('A1 range to read.') },
  'sheets.writeRange': { spreadsheetId: stringProperty('Spreadsheet id.'), range: stringProperty('A1 range to write.'), values: arrayProperty('Rows of cell values.', { type: 'array' }) },
  'sheets.appendRows': { spreadsheetId: stringProperty('Spreadsheet id.'), range: stringProperty('A1 range used for append.'), values: arrayProperty('Rows of cell values.', { type: 'array' }) },
  'sheets.updateCell': { spreadsheetId: stringProperty('Spreadsheet id.'), range: stringProperty('A1 cell to write.'), value: { description: 'Cell value to write.' } },
  'sheets.insertRows': { spreadsheetId: stringProperty('Spreadsheet id.'), sheetId: { type: 'integer', minimum: 0, description: 'Numeric sheet id from getSpreadsheet.' }, startIndex: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, maximum: 100 } },
  'sheets.batchUpdate': { spreadsheetId: stringProperty('Spreadsheet id.'), requests: arrayProperty('Explicit Sheets batch update requests.', objectProperty('A Sheets batch update request.')) },
  'roleplay_setting.list': { parentId: stringProperty('Optional parent entity id.') },
  'roleplay_setting.inspect': { id: stringProperty('Optional entity id.'), ref: stringProperty('Optional opaque 16-hex world reference.') },
  'roleplay_setting.create': { type: { type: 'string', enum: ['building','room','outdoor','place','area','object','world'] }, name: stringProperty('Entity name.'), description: stringProperty('Entity description.'), parentId: stringProperty('Optional parent entity id.') },
  'roleplay_setting.update': { id: stringProperty('Optional entity id.'), ref: stringProperty('Optional opaque 16-hex world reference.'), name: stringProperty('Optional replacement name.'), description: stringProperty('Optional replacement description.'), parentId: stringProperty('Optional destination parent id.'), type: { type: 'string', enum: ['building','room','outdoor','place','area','object','world'] } },
  'roleplay_setting.move': { id: stringProperty('Optional entity id.'), ref: stringProperty('Optional opaque 16-hex world reference.'), parentId: stringProperty('Optional destination parent id.') },
  'roleplay_setting.delete': { id: stringProperty('Optional entity id.'), ref: stringProperty('Optional opaque 16-hex world reference.') },
  'memory.lookup': {
    query: { type: 'string', minLength: 1, maxLength: 500, description: 'Concise query for finding an existing established durable memory to manage. Normal conversational recall is already automatic.' },
  },
  'memory.save': {
    title: { type: 'string', minLength: 1, maxLength: 160, description: 'Short durable-memory title.' },
    body: { type: 'string', minLength: 1, maxLength: 4_000, description: 'Concise durable fact, preference, decision, commitment, or other information the user explicitly asked Elara to retain.' },
    kind: { type: 'string', enum: ['CONTEXTUAL', 'EPISODIC'], description: 'CONTEXTUAL for durable facts/preferences/working context; EPISODIC for a specific durable event or experience. Defaults to CONTEXTUAL.' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Optional confidence from 0 to 1. Omit when the default is appropriate.' },
    importance: { type: 'number', minimum: 0, maximum: 1, description: 'Optional importance from 0 to 1. Omit when the default is appropriate.' },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 12, description: 'Optional concise search tags.' },
  },
  'memory.reconcile': {
    targetRef: { type: 'string', minLength: 1, maxLength: 96, description: 'Opaque reference returned by memory.lookup in this same turn. Never supply a raw memory id.' },
    relation: { type: 'string', enum: ['support', 'conflict', 'related', 'supersede'], description: 'How the new user-authored evidence relates to the selected memory.' },
    title: { type: 'string', minLength: 1, maxLength: 160, description: 'Short title for the new evidence or replacement memory.' },
    body: { type: 'string', minLength: 1, maxLength: 4_000, description: 'Concise user-authored evidence or replacement statement.' },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 12, description: 'Optional concise search tags.' },
  },
  'youtube.search': {
    queries: {
      type: 'array',
      items: stringProperty('A concise YouTube search query that reflects the user request.'),
      minItems: 1,
      maxItems: MAX_MEDIA_QUERIES_PER_CALL,
      description: `Use one query by default. At most ${MAX_MEDIA_QUERIES_PER_CALL} distinct queries are accepted, only when the user explicitly asks for separate searches. Never add synonyms or rephrasings merely to broaden results. Do not page.`,
    },
    // Deliberately not in `requiredByTool`: omitting it is a valid call, and the
    // app supplies the default. The model only needs to state an intent when it
    // differs from the default.
    intent: {
      type: 'string',
      enum: ['watch', 'listen'],
      description:
        "Presentation intent only: 'listen' when the user asked for music/audio and 'watch' for video. It does not change the YouTube search request or cache identity. Elara never plays media itself. Defaults to 'watch'. Applies to the whole call.",
    },
  },
};

const requiredByTool: Record<string, readonly string[]> = {
  'calendar.getEvent': ['eventId'],
  'calendar.queryFreeBusy': ['timeMin', 'timeMax', 'calendarIds'],
  'calendar.createEvent': ['summary', 'start', 'end'],
  'calendar.updateEvent': ['eventId', 'etag'],
  'calendar.deleteEvent': ['eventId', 'etag'],
  'tasks.listTasks': ['taskListId'], 'tasks.getTask': ['taskListId', 'taskId'], 'tasks.createTask': ['taskListId', 'task'], 'tasks.updateTask': ['taskListId', 'taskId', 'task'], 'tasks.moveTask': ['taskListId', 'taskId'], 'tasks.deleteTask': ['taskListId', 'taskId'], 'tasks.clearCompleted': ['taskListId'],
  'docs.getDocument': ['documentId'], 'docs.inspectDocument': ['documentId'], 'docs.createDocument': ['title'], 'docs.insertText': ['documentId', 'index', 'text'], 'docs.appendParagraph': ['documentId', 'text'], 'docs.replaceText': ['documentId', 'findText', 'replaceText'], 'docs.batchUpdate': ['documentId', 'requests'],
  'document.create_pdf': ['source'],
  'chat.listMessages': ['spaceName'], 'chat.getMessage': ['messageName'], 'chat.createMessage': ['spaceName', 'message'], 'chat.updateMessage': ['messageName', 'message', 'updateMask'], 'chat.deleteMessage': ['messageName'],
  'gmail.getMessage': ['messageId'], 'gmail.getThread': ['threadId'], 'gmail.getLabel': ['labelId'], 'gmail.modifyMessage': ['messageId'], 'gmail.modifyThread': ['threadId'], 'gmail.trashMessage': ['messageId'], 'gmail.untrashMessage': ['messageId'], 'gmail.trashThread': ['threadId'], 'gmail.untrashThread': ['threadId'], 'gmail.createLabel': ['label'], 'gmail.updateLabel': ['labelId', 'label'], 'gmail.deleteLabel': ['labelId'], 'gmail.sendMessage': ['to', 'subject', 'body'],
  'drive.getFile': ['fileId'], 'drive.downloadFile': ['fileId'], 'drive.createFile': ['name'], 'drive.updateFile': ['fileId', 'patch'], 'drive.moveFile': ['fileId', 'parentId'],
  'sheets.getSpreadsheet': ['spreadsheetId'], 'sheets.readRange': ['spreadsheetId', 'range'], 'sheets.writeRange': ['spreadsheetId', 'range', 'values'], 'sheets.appendRows': ['spreadsheetId', 'range', 'values'], 'sheets.updateCell': ['spreadsheetId', 'range'], 'sheets.insertRows': ['spreadsheetId', 'sheetId', 'startIndex', 'count'], 'sheets.batchUpdate': ['spreadsheetId', 'requests'],
  'roleplay_setting.create': ['type', 'name'],
  'memory.lookup': ['query'],
  'memory.save': ['title', 'body'],
  'memory.reconcile': ['targetRef', 'relation', 'title', 'body'],
  'youtube.search': ['queries'],
};

const geminiVisibleTools = googleToolRegistry.filter((descriptor) => descriptor.exposure === 'gemini');

function toFunctionDeclaration(descriptor: GoogleToolDescriptor): GeminiFunctionDeclaration {
  const properties = toolProperties[descriptor.name] ?? {};
  const required = requiredByTool[descriptor.name];
  return {
    type: 'function',
    name: descriptor.name,
    description: descriptor.description,
    parameters: {
      type: 'object',
      properties,
      additionalProperties: false,
      ...(required ? { required } : {}),
    },
  };
}

/**
 * Every Gemini-visible declaration, regardless of execution plane.
 *
 * This is the browser's list, because the browser is the only plane with tool
 * handlers. Anything that merely proxies a Gemini call — notably the Cloudflare
 * Worker — must use {@link googleGeminiFunctionDeclarationsForPlane} instead, or
 * it will advertise tools it cannot execute.
 */
export const googleGeminiFunctionDeclarations: readonly GeminiFunctionDeclaration[] = geminiVisibleTools.map(toFunctionDeclaration);

/** Gemini-visible declarations that `plane` can actually execute. */
export function googleGeminiFunctionDeclarationsForPlane(plane: GoogleToolExecutionPlane): readonly GeminiFunctionDeclaration[] {
  return googleToolsForPlane(plane)
    .filter((descriptor) => descriptor.exposure === 'gemini')
    .map(toFunctionDeclaration);
}

export function googleGeminiFunctionNames(): readonly string[] {
  return geminiVisibleTools.map((tool) => tool.name);
}
