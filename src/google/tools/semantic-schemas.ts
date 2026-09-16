import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const emailSchema = z.string().trim().email().max(320);
const timestampSchema = z.string().trim().min(1).max(128);
const timeZoneSchema = z.string().trim().min(1).max(200).optional();
const concreteEtagSchema = z.string().trim().min(1).max(1024).regex(/^(?:W\/)?"[^"]+"$/, 'Calendar mutations require one concrete provider ETag.');
const recurrenceSchema = z.array(
  z.string().trim().min(1).max(2000).regex(/^(?:RRULE|EXRULE|RDATE|EXDATE):/i, 'Recurrence entries must begin with RRULE:, EXRULE:, RDATE:, or EXDATE:.'),
).max(20).optional();
const sendUpdatesSchema = z.enum(['all', 'externalOnly']).optional();

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

export const semanticToolArgumentSchemas = {
  'calendar.createEvent': calendarCreateSchema,
  'calendar.updateEvent': calendarUpdateSchema,
  'calendar.deleteEvent': z.object({
    calendarId: idSchema.optional(),
    eventId: z.string().trim().min(1).max(1024),
    etag: concreteEtagSchema,
    sendUpdates: sendUpdatesSchema,
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
