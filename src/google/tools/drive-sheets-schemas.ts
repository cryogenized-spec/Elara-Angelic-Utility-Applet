import { z } from 'zod';

const fileIdSchema = z.string().trim().min(1).max(500);
const a1RangeSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(2048);
const rowSchema = z.array(z.unknown()).max(100);
const valuesSchema = z.array(rowSchema).min(1).max(1000);
const updateRequestSchema = z.record(z.string(), z.unknown());

export const driveSheetsToolArgumentSchemas = {
  'drive.searchFiles': z.object({
    query: z.string().trim().max(2000).optional(),
    pageToken: pageTokenSchema.optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }).strict(),
  'drive.getFile': z.object({ fileId: fileIdSchema }).strict(),
  'drive.downloadFile': z.object({ fileId: fileIdSchema }).strict(),
  'drive.createFile': z.object({
    name: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(200).optional(),
    parents: z.array(fileIdSchema).max(20).optional(),
  }).strict(),
  'drive.updateFile': z.object({
    fileId: fileIdSchema,
    patch: z.object({
      name: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(2000).optional(),
      starred: z.boolean().optional(),
      trashed: z.boolean().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, 'At least one file field is required.'),
  }).strict(),
  'drive.moveFile': z.object({
    fileId: fileIdSchema,
    parentId: fileIdSchema,
    previousParentId: fileIdSchema.optional(),
  }).strict(),
  'sheets.getSpreadsheet': z.object({ spreadsheetId: fileIdSchema }).strict(),
  'sheets.readRange': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema }).strict(),
  'sheets.writeRange': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema, values: valuesSchema }).strict(),
  'sheets.appendRows': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema, values: valuesSchema }).strict(),
  'sheets.batchUpdate': z.object({ spreadsheetId: fileIdSchema, requests: z.array(updateRequestSchema).min(1).max(100) }).strict(),
} as const;

export type DriveSheetsToolName = keyof typeof driveSheetsToolArgumentSchemas;

export type DriveSheetsToolArguments<T extends DriveSheetsToolName> = z.infer<(typeof driveSheetsToolArgumentSchemas)[T]>;

export function validateDriveSheetsToolArguments<T extends DriveSheetsToolName>(tool: T, argumentsValue: unknown): DriveSheetsToolArguments<T> {
  return driveSheetsToolArgumentSchemas[tool].parse(argumentsValue) as DriveSheetsToolArguments<T>;
}
