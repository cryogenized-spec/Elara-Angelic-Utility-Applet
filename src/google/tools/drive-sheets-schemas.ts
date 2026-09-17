import { z } from 'zod';

const fileIdSchema = z.string().trim().min(1).max(500);
const a1RangeSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(2048);
const rowSchema = z.array(z.unknown()).max(100);
const valuesSchema = z.array(rowSchema).min(1).max(1000);
const updateRequestSchema = z.record(z.string(), z.unknown());
const cellValueSchema = z.string().max(50_000);

function isSingleCellA1(value: string): boolean {
  const normalized = value.trim();
  const bang = normalized.lastIndexOf('!');
  const cell = bang >= 0 ? normalized.slice(bang + 1) : normalized;
  const sheet = bang >= 0 ? normalized.slice(0, bang) : undefined;
  if (sheet !== undefined) {
    if (!sheet || sheet.includes('!') || sheet.includes(':') || sheet.includes(',')) return false;
    const startsQuoted = sheet.startsWith("'");
    const endsQuoted = sheet.endsWith("'");
    if (startsQuoted !== endsQuoted) return false;
  }
  return /^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/.test(cell);
}

const singleCellA1Schema = a1RangeSchema.refine(
  isSingleCellA1,
  'Google Sheets updateCell requires one A1 cell reference, not a range, row, column, or named range.',
);

export const driveSheetsToolArgumentSchemas = {
  'drive.searchFiles': z.object({
    query: z.string().trim().max(2000).optional(),
    pageToken: pageTokenSchema.optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }).strict(),
  'drive.searchLibrary': z.object({
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
  'sheets.updateCell': z.object({
    spreadsheetId: fileIdSchema,
    range: singleCellA1Schema,
    value: cellValueSchema,
  }).strict(),
  'sheets.insertRows': z.object({
    spreadsheetId: fileIdSchema,
    sheetId: z.number().int().min(0),
    startIndex: z.number().int().min(0).max(100_000),
    count: z.number().int().min(1).max(100),
  }).strict(),
  'sheets.batchUpdate': z.object({ spreadsheetId: fileIdSchema, requests: z.array(updateRequestSchema).min(1).max(100) }).strict(),
} as const;

export type DriveSheetsToolName = keyof typeof driveSheetsToolArgumentSchemas;

export type DriveSheetsToolArguments<T extends DriveSheetsToolName> = z.infer<(typeof driveSheetsToolArgumentSchemas)[T]>;

export function validateDriveSheetsToolArguments<T extends DriveSheetsToolName>(tool: T, argumentsValue: unknown): DriveSheetsToolArguments<T> {
  return driveSheetsToolArgumentSchemas[tool].parse(argumentsValue) as DriveSheetsToolArguments<T>;
}
