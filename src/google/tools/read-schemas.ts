import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(2048);
const querySchema = z.string().trim().max(2000);
const optionalText = z.string().trim().max(200).optional();
const timestampSchema = z.string().trim().min(1).max(128).optional();
const metadataHeadersSchema = z.array(z.string().trim().min(1).max(200)).max(50).optional();

export const googleReadToolArgumentSchemas = {
  'calendar.listEvents': z.object({
    calendarId: idSchema.optional(),
    timeMin: timestampSchema,
    timeMax: timestampSchema,
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
    format: z.enum(['minimal', 'full', 'raw', 'metadata']).optional(),
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
