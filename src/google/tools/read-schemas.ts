import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(2048);
const querySchema = z.string().trim().max(2000);
const timestampValueSchema = z.string().trim().min(1).max(128);
const timestampSchema = timestampValueSchema.optional();
const calendarQueryTimestampValueSchema = timestampValueSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  'Calendar query bounds must be RFC 3339 timestamps with an explicit UTC offset.',
);
const calendarQueryTimestampSchema = calendarQueryTimestampValueSchema.optional();
const timeZoneSchema = z.string().trim().min(1).max(200).optional();
const metadataHeadersSchema = z.array(z.string().trim().min(1).max(200)).max(50).optional();

export const googleReadToolArgumentSchemas = {
  'calendar.listCalendars': z.object({
    pageToken: pageTokenSchema.optional(),
    maxResults: z.number().int().min(1).max(250).optional(),
    showHidden: z.boolean().optional(),
    minAccessRole: z.enum(['freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner']).optional(),
    showOwnOrganizationOnly: z.boolean().optional(),
  }).strict(),

  'calendar.listEvents': z.object({
    calendarId: idSchema.optional(),
    timeMin: calendarQueryTimestampSchema,
    timeMax: calendarQueryTimestampSchema,
    pageToken: pageTokenSchema.optional(),
    maxResults: z.number().int().min(1).max(250).optional(),
    query: querySchema.optional(),
    timeZone: timeZoneSchema,
  }).strict(),

  'calendar.getEvent': z.object({
    calendarId: idSchema.optional(),
    eventId: idSchema,
    timeZone: timeZoneSchema,
  }).strict(),

  'calendar.getSettings': z.object({}).strict(),

  'calendar.queryFreeBusy': z.object({
    timeMin: calendarQueryTimestampValueSchema,
    timeMax: calendarQueryTimestampValueSchema,
    calendarIds: z.array(idSchema).min(1).max(50),
    timeZone: timeZoneSchema,
  }).strict(),

  'tasks.listTaskLists': z.object({
    pageToken: pageTokenSchema.optional(),
  }).strict(),

  'tasks.listTasks': z.object({
    taskListId: idSchema,
    pageToken: pageTokenSchema.optional(),
    showCompleted: z.boolean().optional(),
    showDeleted: z.boolean().optional(),
    showHidden: z.boolean().optional(),
    dueMin: timestampSchema,
    dueMax: timestampSchema,
    updatedMin: timestampSchema,
    completedMin: timestampSchema,
    completedMax: timestampSchema,
    maxResults: z.number().int().min(1).max(100).optional(),
  }).strict(),

  'tasks.getTask': z.object({
    taskListId: idSchema,
    taskId: idSchema,
  }).strict(),

  'gmail.listMessages': z.object({
    query: querySchema.optional(),
    pageToken: pageTokenSchema.optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    includeSpamTrash: z.boolean().optional(),
  }).strict(),

  'gmail.getMessage': z.object({
    messageId: idSchema,
    format: z.enum(['minimal', 'full', 'metadata']).optional(),
    metadataHeaders: metadataHeadersSchema,
  }).strict(),

  'gmail.listThreads': z.object({
    query: querySchema.optional(),
    pageToken: pageTokenSchema.optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    includeSpamTrash: z.boolean().optional(),
  }).strict(),

  'gmail.getThread': z.object({
    threadId: idSchema,
    format: z.enum(['minimal', 'full', 'metadata']).optional(),
    metadataHeaders: metadataHeadersSchema,
  }).strict(),

  'gmail.listLabels': z.object({}).strict(),

  'gmail.getLabel': z.object({
    labelId: idSchema,
  }).strict(),
} as const;

export type GoogleReadToolName = keyof typeof googleReadToolArgumentSchemas;
export type GoogleReadToolArguments<T extends GoogleReadToolName> = z.infer<(typeof googleReadToolArgumentSchemas)[T]>;

export function validateGoogleReadToolArguments<T extends GoogleReadToolName>(tool: T, value: unknown): GoogleReadToolArguments<T> {
  return googleReadToolArgumentSchemas[tool].parse(value) as GoogleReadToolArguments<T>;
}
