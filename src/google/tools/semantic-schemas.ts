import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const emailSchema = z.string().trim().email().max(320);
const ALL_DAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))?$/i;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function hasValidDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isValidAllDayDate(value: string): boolean {
  const match = ALL_DAY_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  return hasValidDateParts(Number(year), Number(month), Number(day));
}

function isValidCalendarDateTime(value: string): boolean {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  if (!hasValidDateParts(Number(year), Number(month), Number(day))) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function isValidCalendarBoundary(value: string): boolean {
  return isValidAllDayDate(value) || isValidCalendarDateTime(value);
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

const timestampSchema = z.string().trim().min(1).max(128)
  .refine(isValidCalendarBoundary, 'Calendar boundary must be a real YYYY-MM-DD date or valid RFC 3339-style date-time.');
const timeZoneSchema = z.string().trim().min(1).max(200)
  .refine(isValidIanaTimeZone, 'Calendar time zone must be a valid IANA time zone.')
  .optional();
const concreteEtagSchema = z.string().trim().min(1).max(1024).regex(/^"[^"]+"$/, 'Calendar mutations require one concrete strong provider ETag.');
const recurrenceSchema = z.array(
  z.string().trim().min(1).max(2000).regex(/^(?:RRULE|EXRULE|RDATE|EXDATE):/i, 'Recurrence entries must begin with RRULE:, EXRULE:, RDATE:, or EXDATE:.'),
).max(20).optional();
const sendUpdatesSchema = z.enum(['all', 'externalOnly']).optional();
const taskTitleSchema = z.string().trim().min(1).max(1024);
const taskNotesSchema = z.string().trim().max(8192);
const taskScheduledDateSchema = z.string().trim().refine(
  isValidAllDayDate,
  'Google Tasks scheduledDate must be a real YYYY-MM-DD date. Tasks does not support time-of-day scheduling through this field.',
);
const taskStatusSchema = z.enum(['needsAction', 'completed']);

function isTimedValue(value: string | undefined): boolean {
  return value?.includes('T') ?? false;
}

function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function requireTimezoneForOffsetFreeBoundary(
  value: string | undefined,
  timeZone: string | undefined,
  path: 'start' | 'end',
  context: z.RefinementCtx,
): void {
  if (value && isTimedValue(value) && !hasExplicitOffset(value) && !timeZone) {
    context.addIssue({ code: 'custom', path: [path], message: 'Calendar date-times without a UTC offset require an explicit time zone.' });
  }
}

function requireMatchingBoundaryModes(
  start: string | undefined,
  end: string | undefined,
  context: z.RefinementCtx,
): void {
  if (start === undefined || end === undefined) return;
  const startTimed = isTimedValue(start);
  const endTimed = isTimedValue(end);
  if (startTimed !== endTimed) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'Calendar start/end must both be date-times or both be all-day dates.' });
    return;
  }
  if (startTimed && hasExplicitOffset(start) !== hasExplicitOffset(end)) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'Calendar timed start/end must both include UTC offsets or both rely on the explicit time zone.' });
  }
}

function calendarBoundaryMillis(value: string): number {
  if (isValidAllDayDate(value)) return Date.parse(`${value}T00:00:00Z`);
  return Date.parse(hasExplicitOffset(value) ? value : `${value}Z`);
}

function requireEndAfterStart(
  start: string | undefined,
  end: string | undefined,
  context: z.RefinementCtx,
): void {
  if (start === undefined || end === undefined) return;
  if (calendarBoundaryMillis(end) <= calendarBoundaryMillis(start)) {
    context.addIssue({
      code: 'custom',
      path: ['end'],
      message: 'Calendar end must be after start. For all-day events, end is exclusive: a one-day event ends on the following date.',
    });
  }
}

const calendarCreateSchema = z.object({
  calendarId: idSchema.optional(),
  summary: z.string().trim().min(1).max(1000),
  start: timestampSchema,
  end: timestampSchema,
  timeZone: timeZoneSchema,
  location: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(8000).optional(),
  attendees: z.array(emailSchema).max(50).optional(),
  recurrence: recurrenceSchema,
  sendUpdates: sendUpdatesSchema,
}).strict().superRefine((value, context) => {
  requireMatchingBoundaryModes(value.start, value.end, context);
  requireEndAfterStart(value.start, value.end, context);
  requireTimezoneForOffsetFreeBoundary(value.start, value.timeZone, 'start', context);
  requireTimezoneForOffsetFreeBoundary(value.end, value.timeZone, 'end', context);
  if (value.recurrence?.length && (isTimedValue(value.start) || isTimedValue(value.end)) && !value.timeZone) {
    context.addIssue({ code: 'custom', path: ['timeZone'], message: 'Recurring Calendar date-time events require an explicit time zone.' });
  }
});

const calendarUpdateSchema = z.object({
  calendarId: idSchema.optional(),
  eventId: z.string().trim().min(1).max(1024),
  etag: concreteEtagSchema,
  summary: z.string().trim().max(1000).optional(),
  start: timestampSchema.optional(),
  end: timestampSchema.optional(),
  timeZone: timeZoneSchema,
  location: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(8000).optional(),
  attendees: z.array(emailSchema).max(50).optional(),
  recurrence: recurrenceSchema,
  sendUpdates: sendUpdatesSchema,
}).strict().superRefine((value, context) => {
  const hasEventChange = ['summary', 'start', 'end', 'location', 'description', 'attendees', 'recurrence']
    .some((field) => value[field as keyof typeof value] !== undefined);
  if (!hasEventChange) context.addIssue({ code: 'custom', message: 'Calendar update requires at least one event field change.' });

  const updatesStart = value.start !== undefined;
  const updatesEnd = value.end !== undefined;
  if (updatesStart !== updatesEnd) {
    context.addIssue({
      code: 'custom',
      path: [updatesStart ? 'end' : 'start'],
      message: 'Changing Calendar event timing requires both start and end boundaries.',
    });
  }

  requireMatchingBoundaryModes(value.start, value.end, context);
  requireEndAfterStart(value.start, value.end, context);
  requireTimezoneForOffsetFreeBoundary(value.start, value.timeZone, 'start', context);
  requireTimezoneForOffsetFreeBoundary(value.end, value.timeZone, 'end', context);

  if (value.recurrence?.length) {
    if (value.start === undefined || value.end === undefined) {
      context.addIssue({ code: 'custom', path: ['recurrence'], message: 'Adding or changing Calendar recurrence requires explicit start and end boundaries.' });
    } else if ((isTimedValue(value.start) || isTimedValue(value.end)) && !value.timeZone) {
      context.addIssue({ code: 'custom', path: ['timeZone'], message: 'Recurring Calendar date-time updates require an explicit time zone.' });
    }
  }
});

const taskUpdateSchema = z.object({
  taskListId: idSchema,
  taskId: idSchema,
  title: taskTitleSchema.optional(),
  notes: taskNotesSchema.optional(),
  scheduledDate: taskScheduledDateSchema.optional(),
  clearScheduledDate: z.boolean().optional(),
  status: taskStatusSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.scheduledDate !== undefined && value.clearScheduledDate) {
    context.addIssue({ code: 'custom', path: ['clearScheduledDate'], message: 'A task update cannot set and clear scheduledDate in the same call.' });
  }
  if (value.title === undefined && value.notes === undefined && value.scheduledDate === undefined && !value.clearScheduledDate && value.status === undefined) {
    context.addIssue({ code: 'custom', message: 'Google Tasks update requires at least one task field change.' });
  }
});

export const semanticToolArgumentSchemas = {
  'calendar.createEvent': calendarCreateSchema,
  'calendar.updateEvent': calendarUpdateSchema,
  'calendar.deleteEvent': z.object({
    calendarId: idSchema.optional(),
    eventId: z.string().trim().min(1).max(1024),
    etag: concreteEtagSchema,
    sendUpdates: sendUpdatesSchema,
  }).strict(),
  'tasks.createTaskList': z.object({
    title: taskTitleSchema,
  }).strict(),
  'tasks.updateTaskList': z.object({
    taskListId: idSchema,
    title: taskTitleSchema,
  }).strict(),
  'tasks.deleteTaskList': z.object({
    taskListId: idSchema,
  }).strict(),
  'tasks.createTask': z.object({
    taskListId: idSchema,
    title: taskTitleSchema,
    notes: taskNotesSchema.optional(),
    scheduledDate: taskScheduledDateSchema.optional(),
    parent: idSchema.optional(),
    previous: idSchema.optional(),
  }).strict(),
  'tasks.updateTask': taskUpdateSchema,
  'tasks.moveTask': z.object({
    taskListId: idSchema,
    taskId: idSchema,
    destinationTaskListId: idSchema.optional(),
    parent: idSchema.optional(),
    previous: idSchema.optional(),
  }).strict(),
  'tasks.deleteTask': z.object({
    taskListId: idSchema,
    taskId: idSchema,
  }).strict(),
  'tasks.clearCompleted': z.object({
    taskListId: idSchema,
  }).strict(),
  'gmail.sendMessage': z.object({
    to: z.array(emailSchema).min(1).max(25),
    cc: z.array(emailSchema).max(25).optional(),
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(200_000),
    threadId: idSchema.optional(),
  }).strict(),
  'docs.inspectDocument': z.object({ documentId: idSchema }).strict(),
  'docs.insertText': z.object({
    documentId: idSchema,
    index: z.number().int().min(1).max(5_000_000),
    text: z.string().min(1).max(20_000),
  }).strict(),
  'docs.appendParagraph': z.object({
    documentId: idSchema,
    text: z.string().min(1).max(20_000),
  }).strict(),
  'docs.replaceText': z.object({
    documentId: idSchema,
    findText: z.string().min(1).max(2000),
    replaceText: z.string().max(20_000),
    matchCase: z.boolean().optional(),
  }).strict(),
  'document.create_pdf': z.object({
    source: z.string().trim().min(1).max(200_000),
    title: z.string().trim().max(180).optional(),
  }).strict(),
} as const;

export type SemanticToolName = keyof typeof semanticToolArgumentSchemas;
export type SemanticToolArguments<T extends SemanticToolName> = z.infer<(typeof semanticToolArgumentSchemas)[T]>;

export function validateSemanticToolArguments<T extends SemanticToolName>(tool: T, value: unknown): SemanticToolArguments<T> {
  return semanticToolArgumentSchemas[tool].parse(value) as SemanticToolArguments<T>;
}
