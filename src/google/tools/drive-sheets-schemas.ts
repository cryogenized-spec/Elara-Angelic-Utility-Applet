import { z } from 'zod';
import { DRIVE_LIMITS } from '../drive/limits';

const fileIdSchema = z.string().trim().min(1).max(DRIVE_LIMITS.maxFileIdLength);
const a1RangeSchema = z.string().trim().min(1).max(500);
const pageTokenSchema = z.string().trim().min(1).max(DRIVE_LIMITS.maxPageTokenLength);
const etagSchema = z.string().trim().min(2).max(DRIVE_LIMITS.maxEtagLength);
const cellValueSchema = z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]);
const rowSchema = z.array(cellValueSchema).max(100);
const valuesSchema = z.array(rowSchema).min(1).max(1000).superRefine((rows, context) => {
  const cellCount = rows.reduce((total, row) => total + row.length, 0);
  if (cellCount > 10_000) context.addIssue({ code: 'custom', message: 'Google Sheets writes are limited to 10,000 cells per operation.' });
  if (new TextEncoder().encode(JSON.stringify({ values: rows })).byteLength > 1_000_000) context.addIssue({ code: 'custom', message: 'Google Sheets write exceeds the application request limit.' });
});
const updateRequestSchema = z.record(z.string(), z.unknown());
const inputModeSchema = z.enum(['literal', 'userEntered']).optional();

function singleCellPart(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;

  if (normalized.startsWith("'")) {
    let hasTitleContent = false;
    for (let index = 1; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character !== "'") {
        hasTitleContent = true;
        continue;
      }
      if (normalized[index + 1] === "'") {
        hasTitleContent = true;
        index += 1;
        continue;
      }
      if (!hasTitleContent || normalized[index + 1] !== '!') return undefined;
      return normalized.slice(index + 2);
    }
    return undefined;
  }

  const bang = normalized.indexOf('!');
  if (bang < 0) return normalized;
  if (normalized.indexOf('!', bang + 1) >= 0) return undefined;
  const sheet = normalized.slice(0, bang);
  if (!sheet || /[:,']/.test(sheet)) return undefined;
  return normalized.slice(bang + 1);
}

function isSingleCellA1(value: string): boolean {
  const cell = singleCellPart(value);
  return cell !== undefined && /^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/.test(cell);
}

const singleCellA1Schema = a1RangeSchema.refine(
  isSingleCellA1,
  'Google Sheets updateCell requires one A1 cell reference, not a range, row, column, or named range.',
);

export const driveSheetsToolArgumentSchemas = {
  'drive.searchFiles': z.object({
    query: z.string().trim().max(DRIVE_LIMITS.maxQueryLength).optional(),
    pageToken: pageTokenSchema.optional(),
    pageSize: z.number().int().min(1).max(DRIVE_LIMITS.maxPageSize).optional(),
    showTrashed: z.boolean().optional(),
  }).strict(),
  'drive.searchLibrary': z.object({
    query: z.string().trim().max(DRIVE_LIMITS.maxQueryLength).optional(),
    pageToken: pageTokenSchema.optional(),
    pageSize: z.number().int().min(1).max(DRIVE_LIMITS.maxPageSize).optional(),
    showTrashed: z.boolean().optional(),
  }).strict(),
  'drive.getFile': z.object({ fileId: fileIdSchema }).strict(),
  'drive.downloadFile': z.object({
    fileId: fileIdSchema,
    maxBytes: z.number().int().min(1).max(DRIVE_LIMITS.maxTransferBytes).optional(),
  }).strict(),
  'drive.createFile': z.object({
    name: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(200).optional(),
    parents: z.array(fileIdSchema).max(DRIVE_LIMITS.maxParents).optional(),
  }).strict(),
  'drive.updateFile': z.object({
    fileId: fileIdSchema,
    etag: etagSchema,
    patch: z.object({
      name: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(2000).optional(),
      starred: z.boolean().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, 'At least one file field is required.'),
  }).strict(),
  'drive.moveFile': z.object({
    fileId: fileIdSchema,
    etag: etagSchema,
    parentId: fileIdSchema,
    previousParentId: fileIdSchema.optional(),
  }).strict(),
  'drive.trashFile': z.object({
    fileId: fileIdSchema,
    etag: etagSchema,
  }).strict(),
  'sheets.getSpreadsheet': z.object({ spreadsheetId: fileIdSchema }).strict(),
  'sheets.readRange': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema }).strict(),
  'sheets.createSpreadsheet': z.object({
    title: z.string().trim().min(1).max(500),
    firstSheetTitle: z.string().trim().min(1).max(100).optional(),
  }).strict(),
  'sheets.addSheet': z.object({
    spreadsheetId: fileIdSchema,
    title: z.string().trim().min(1).max(100),
    rowCount: z.number().int().min(1).max(100_000).optional(),
    columnCount: z.number().int().min(1).max(1_000).optional(),
  }).strict(),
  'sheets.writeRange': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema, values: valuesSchema, inputMode: inputModeSchema }).strict(),
  'sheets.appendRows': z.object({ spreadsheetId: fileIdSchema, range: a1RangeSchema, values: valuesSchema, inputMode: inputModeSchema }).strict(),
  'sheets.updateCell': z.object({
    spreadsheetId: fileIdSchema,
    range: singleCellA1Schema,
    value: cellValueSchema,
    inputMode: inputModeSchema,
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
