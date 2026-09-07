import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const emailSchema = z.string().trim().email().max(320);
const timestampSchema = z.string().trim().min(1).max(128);

export const semanticToolArgumentSchemas = {
  'calendar.createEvent': z.object({
    calendarId: idSchema.optional(),
    summary: z.string().trim().min(1).max(1000),
    start: timestampSchema,
    end: timestampSchema,
    location: z.string().trim().max(1000).optional(),
    description: z.string().trim().max(8000).optional(),
    attendees: z.array(emailSchema).max(50).optional(),
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
} as const;

export type SemanticToolName = keyof typeof semanticToolArgumentSchemas;
export type SemanticToolArguments<T extends SemanticToolName> = z.infer<(typeof semanticToolArgumentSchemas)[T]>;

export function validateSemanticToolArguments<T extends SemanticToolName>(tool: T, value: unknown): SemanticToolArguments<T> {
  return semanticToolArgumentSchemas[tool].parse(value) as SemanticToolArguments<T>;
}
