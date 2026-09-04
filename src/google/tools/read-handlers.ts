import { z } from 'zod';
import { GoogleCalendarService } from '../calendar/service';
import { GoogleTasksService } from '../tasks/service';
import { GoogleGmailService } from '../gmail/service';
import { googleOAuthAuthority } from '../oauth/authority';
import type { GoogleToolHandlers } from './executor';
import { googleToolNameSchema, type GoogleToolName } from './contracts';
import { googleReadToolArgumentSchemas, validateGoogleReadToolArguments } from './read-schemas';

const calendar = new GoogleCalendarService(googleOAuthAuthority);
const tasks = new GoogleTasksService(googleOAuthAuthority);
const gmail = new GoogleGmailService(googleOAuthAuthority);

const readToolNames = Object.keys(googleReadToolArgumentSchemas).filter((name): name is GoogleToolName => googleToolNameSchema.safeParse(name).success);

function readArgs<T extends keyof typeof googleReadToolArgumentSchemas>(tool: T, value: Record<string, unknown>) {
  return validateGoogleReadToolArguments(tool, value);
}

export const googleReadToolHandlers: GoogleToolHandlers = {
  'calendar.listEvents': async ({ arguments: args }) => {
    const parsed = readArgs('calendar.listEvents', args);
    return calendar.listEvents(parsed.calendarId, parsed.timeMin, parsed.timeMax);
  },
  'tasks.listTaskLists': async ({ arguments: args }) => {
    const parsed = readArgs('tasks.listTaskLists', args);
    return tasks.listTaskLists(parsed.pageToken);
  },
  'tasks.listTasks': async ({ arguments: args }) => {
    const parsed = readArgs('tasks.listTasks', args);
    return tasks.listTasks(parsed.taskListId, {
      pageToken: parsed.pageToken,
      showCompleted: parsed.showCompleted,
      showDeleted: parsed.showDeleted,
      showHidden: parsed.showHidden,
      dueMin: parsed.dueMin,
      dueMax: parsed.dueMax,
      updatedMin: parsed.updatedMin,
      completedMin: parsed.completedMin,
      completedMax: parsed.completedMax,
      maxResults: parsed.maxResults,
    });
  },
  'tasks.getTask': async ({ arguments: args }) => {
    const parsed = readArgs('tasks.getTask', args);
    return tasks.getTask(parsed.taskListId, parsed.taskId);
  },
  'gmail.listMessages': async ({ arguments: args }) => {
    const parsed = readArgs('gmail.listMessages', args);
    return gmail.listMessages(parsed.query, parsed.pageToken, parsed.maxResults, parsed.includeSpamTrash);
  },
  'gmail.getMessage': async ({ arguments: args }) => {
    const parsed = readArgs('gmail.getMessage', args);
    return gmail.getMessage(parsed.messageId, parsed.format, parsed.metadataHeaders);
  },
  'gmail.listThreads': async ({ arguments: args }) => {
    const parsed = readArgs('gmail.listThreads', args);
    return gmail.listThreads(parsed.query, parsed.pageToken, parsed.maxResults, parsed.includeSpamTrash);
  },
  'gmail.getThread': async ({ arguments: args }) => {
    const parsed = readArgs('gmail.getThread', args);
    return gmail.getThread(parsed.threadId, parsed.format, parsed.metadataHeaders);
  },
  'gmail.listLabels': async ({ arguments: args }) => {
    readArgs('gmail.listLabels', args);
    return gmail.listLabels();
  },
  'gmail.getLabel': async ({ arguments: args }) => {
    const parsed = readArgs('gmail.getLabel', args);
    return gmail.getLabel(parsed.labelId);
  },
};

export const GOOGLE_READ_TOOL_NAMES: readonly GoogleToolName[] = readToolNames;

export function assertReadToolName(value: string): GoogleToolName {
  const parsed = googleToolNameSchema.parse(value);
  if (!GOOGLE_READ_TOOL_NAMES.includes(parsed)) throw new z.ZodError([]);
  return parsed;
}
