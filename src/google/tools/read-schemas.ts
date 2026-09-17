import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(5000);
const querySchema = z.string().trim().max(2000);
const timestampValueSchema = z.string().trim().min(1).max(128);
const RFC3339_OFFSET_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))$/i;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidOffsetTimestamp(value: string): boolean {
  const match = RFC3339_OFFSET_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > daysInMonth(numericYear, numericMonth)) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function isValidIanaTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

const offsetTimestampValueSchema = timestampValueSchema.refine(
  isValidOffsetTimestamp,
  'Timestamp bounds must be real RFC 3339 timestamps with an explicit UTC offset.',
);
const offsetTimestampSchema = offsetTimestampValueSchema.optional();
const timeZoneSchema = z.string().trim().min(1).max(200)
  .refine(isValidIanaTimeZone, 'Calendar time zone must be a valid IANA time zone.')
  .optional();
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
    timeMin: offsetTimestampSchema,
    timeMax: offsetTimestampSchema,
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
    timeMin: offsetTimestampValueSchema,
    timeMax: offsetTimestampValueSchema,
    calendarIds: z.array(idSchema).min(1).max(50),
    timeZone: timeZoneSchema,
  }).strict(),

  'tasks.listTaskLists': z.object({
    pageToken: pageTokenSchema.optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  }).strict(),

  'tasks.getTaskList': z.object({
    taskListId: idSchema,
  }).strict(),

  'tasks.listTasks': z.object({
    taskListId: idSchema,
    pageToken: pageTokenSchema.optional(),
    showCompleted: z.boolean().optional(),
    showDeleted: z.boolean().optional(),
    showHidden: z.boolean().optional(),
    showAssigned: z.boolean().optional(),
    dueMin: offsetTimestampSchema,
    dueMax: offsetTimestampSchema,
    updatedMin: offsetTimestampSchema,
    completedMin: offsetTimestampSchema,
    completedMax: offsetTimestampSchema,
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
