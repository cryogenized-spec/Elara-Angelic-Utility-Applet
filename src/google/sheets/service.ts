import type { GoogleOAuthAuthority } from '../oauth/contracts';
import { boundedGoogleTransferLimit, readBoundedGoogleContent } from '../drive/transfer-boundary';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_ID_LENGTH = 500;
const MAX_RANGE_LENGTH = 500;
const MAX_TITLE_LENGTH = 500;
const MAX_SHEET_TITLE_LENGTH = 100;
const MAX_ROWS = 1000;
const MAX_COLUMNS_PER_ROW = 100;
const MAX_CELLS = 10_000;
const MAX_CELL_STRING_LENGTH = 50_000;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

interface SpreadsheetResponse {
  spreadsheetId?: unknown;
  spreadsheetUrl?: unknown;
  properties?: unknown;
  sheets?: unknown;
}

export interface GoogleSheetRange {
  range: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
}

export interface GoogleSheetValuesResult {
  readonly trust: 'untrusted-external';
  readonly source: 'sheets';
  range?: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values: readonly (readonly GoogleSheetCellValue[])[];
}

export type GoogleSheetCellValue = string | number | boolean | null;
export type GoogleSheetInputMode = 'literal' | 'userEntered';

export interface GoogleSheetsMutationOptions {
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
}

export type GoogleSheetsExportFormat = 'pdf' | 'xlsx';

export interface GoogleSheetsExportResult {
  readonly format: GoogleSheetsExportFormat;
  readonly mimeType: string;
  readonly extension: '.pdf' | '.xlsx';
  readonly bytes: Uint8Array;
}

export interface GoogleSpreadsheetSummary {
  readonly trust: 'untrusted-external';
  readonly source: 'sheets';
  spreadsheetId: string;
  driveFileId: string;
  title: string;
  spreadsheetUrl?: string;
  sheets: readonly {
    sheetId: number;
    title: string;
    index?: number;
    rowCount?: number;
    columnCount?: number;
  }[];
}

function requireText(value: string, field: string, maxLength = MAX_ID_LENGTH): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Sheets ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Sheets ${field} is too long.`);
  return normalized;
}

function spreadsheetId(id: string): string {
  return requireText(id, 'spreadsheet ID');
}

function a1Range(range: string): string {
  return requireText(range, 'A1 range', MAX_RANGE_LENGTH);
}

function requireMutationCurrent(options: GoogleSheetsMutationOptions, operation: string): void {
  if (options.signal?.aborted || options.isGenerationActive?.() === false) {
    throw new DOMException(`${operation} lost turn authority.`, 'AbortError');
  }
}

function inputOption(mode: GoogleSheetInputMode): 'RAW' | 'USER_ENTERED' {
  if (mode === 'literal') return 'RAW';
  if (mode === 'userEntered') return 'USER_ENTERED';
  throw new Error('Google Sheets input mode must be literal or userEntered.');
}

function normalizeCellValue(value: unknown): GoogleSheetCellValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Google Sheets numeric cell values must be finite.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CELL_STRING_LENGTH) throw new Error('Google Sheets cell text exceeds the application limit.');
    return value;
  }
  throw new Error('Google Sheets cell values must be strings, finite numbers, booleans, or null.');
}

function normalizeValues(values: readonly (readonly unknown[])[]): readonly (readonly GoogleSheetCellValue[])[] {
  if (!Array.isArray(values) || !values.length) throw new Error('Google Sheets write requires at least one row.');
  if (values.length > MAX_ROWS) throw new Error(`Google Sheets write is limited to ${MAX_ROWS} rows per operation.`);
  let cells = 0;
  const normalized = values.map((row) => {
    if (!Array.isArray(row)) throw new Error('Google Sheets values must be an array of rows.');
    if (row.length > MAX_COLUMNS_PER_ROW) throw new Error(`Google Sheets rows are limited to ${MAX_COLUMNS_PER_ROW} cells.`);
    cells += row.length;
    if (cells > MAX_CELLS) throw new Error(`Google Sheets writes are limited to ${MAX_CELLS} cells per operation.`);
    return row.map(normalizeCellValue);
  });
  if (new TextEncoder().encode(JSON.stringify({ values: normalized })).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('Google Sheets write exceeds the application request limit.');
  }
  return normalized;
}

function boundedBatchRequests(requests: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  if (!requests.length) throw new Error('Google Sheets batch update requires at least one request.');
  if (requests.length > 100) throw new Error('Google Sheets batch update is limited to 100 requests per operation.');
  if (new TextEncoder().encode(JSON.stringify({ requests })).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('Google Sheets batch update exceeds the application request limit.');
  }
  return requests;
}

function sheetSummaries(payload: SpreadsheetResponse): GoogleSpreadsheetSummary['sheets'] {
  if (!Array.isArray(payload.sheets)) return [];
  const result: GoogleSpreadsheetSummary['sheets'][number][] = [];
  for (const raw of payload.sheets) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const properties = (raw as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue;
    const source = properties as Record<string, unknown>;
    if (!Number.isInteger(source.sheetId) || typeof source.title !== 'string') continue;
    const grid = source.gridProperties && typeof source.gridProperties === 'object' && !Array.isArray(source.gridProperties)
      ? source.gridProperties as Record<string, unknown>
      : {};
    result.push({
      sheetId: source.sheetId as number,
      title: source.title.slice(0, MAX_SHEET_TITLE_LENGTH),
      ...(Number.isInteger(source.index) ? { index: source.index as number } : {}),
      ...(Number.isInteger(grid.rowCount) ? { rowCount: grid.rowCount as number } : {}),
      ...(Number.isInteger(grid.columnCount) ? { columnCount: grid.columnCount as number } : {}),
    });
  }
  return result;
}

function spreadsheetSummary(payload: SpreadsheetResponse, fallbackId?: string, fallbackTitle = 'Untitled spreadsheet'): GoogleSpreadsheetSummary {
  const id = typeof payload.spreadsheetId === 'string' && payload.spreadsheetId.trim()
    ? payload.spreadsheetId.trim().slice(0, MAX_ID_LENGTH)
    : fallbackId?.trim().slice(0, MAX_ID_LENGTH) ?? '';
  if (!id) throw new Error('Google Sheets response did not contain a spreadsheet ID.');
  const properties = payload.properties && typeof payload.properties === 'object' && !Array.isArray(payload.properties)
    ? payload.properties as Record<string, unknown>
    : {};
  const title = typeof properties.title === 'string' && properties.title.trim()
    ? properties.title.trim().slice(0, MAX_TITLE_LENGTH)
    : fallbackTitle;
  return {
    trust: 'untrusted-external',
    source: 'sheets',
    spreadsheetId: id,
    driveFileId: id,
    title,
    ...(typeof payload.spreadsheetUrl === 'string' && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(payload.spreadsheetUrl) && payload.spreadsheetUrl.length <= 2_000
      ? { spreadsheetUrl: payload.spreadsheetUrl }
      : {}),
    sheets: sheetSummaries(payload),
  };
}

export class GoogleSheetsService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async getSpreadsheet(spreadsheetIdValue: string): Promise<GoogleSpreadsheetSummary> {
    const safeId = spreadsheetId(spreadsheetIdValue);
    const id = encodeURIComponent(safeId);
    const fields = encodeURIComponent('spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))');
    const access = await this.oauth.authorize('sheets.read');
    const response = await access.fetch(`${SHEETS_API}/${id}?fields=${fields}`);
    return spreadsheetSummary(await this.readJson<SpreadsheetResponse>(response), safeId);
  }

  async readRange(spreadsheetIdValue: string, rangeValue: string): Promise<GoogleSheetValuesResult> {
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const rangeText = a1Range(rangeValue);
    const range = encodeURIComponent(rangeText);
    const access = await this.oauth.authorize('sheets.read');
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}?majorDimension=ROWS`);
    const payload = await this.readJson<{ range?: unknown; majorDimension?: unknown; values?: unknown }>(response);
    const rawValues = Array.isArray(payload.values) ? payload.values.filter(Array.isArray) as readonly (readonly unknown[])[] : [];
    const values = rawValues.length ? normalizeValues(rawValues) : [];
    return {
      trust: 'untrusted-external',
      source: 'sheets',
      ...(typeof payload.range === 'string' ? { range: payload.range.slice(0, MAX_RANGE_LENGTH) } : {}),
      ...(payload.majorDimension === 'ROWS' || payload.majorDimension === 'COLUMNS' ? { majorDimension: payload.majorDimension } : {}),
      values,
    };
  }

  async writeRange(
    spreadsheetIdValue: string,
    rangeValue: string,
    values: readonly (readonly unknown[])[],
    mode: GoogleSheetInputMode = 'literal',
    options: GoogleSheetsMutationOptions = {},
  ): Promise<GoogleSheetValuesResult> {
    const idValue = spreadsheetId(spreadsheetIdValue);
    const rangeText = a1Range(rangeValue);
    const safeValues = normalizeValues(values);
    const option = inputOption(mode);
    requireMutationCurrent(options, 'Google Sheets write');
    const access = await this.oauth.authorize('sheets.write');
    requireMutationCurrent(options, 'Google Sheets write');
    const id = encodeURIComponent(idValue);
    const range = encodeURIComponent(rangeText);
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}?valueInputOption=${option}&includeValuesInResponse=true&responseValueRenderOption=UNFORMATTED_VALUE`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ range: rangeText, majorDimension: 'ROWS', values: safeValues }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Sheets write'));
    const payload = await this.readJson<{ updatedData?: { range?: unknown; majorDimension?: unknown; values?: unknown } }>(response);
    const updatedValues = Array.isArray(payload.updatedData?.values)
      ? normalizeValues(payload.updatedData.values.filter(Array.isArray) as readonly (readonly unknown[])[])
      : [];
    return {
      trust: 'untrusted-external',
      source: 'sheets',
      ...(typeof payload.updatedData?.range === 'string' ? { range: payload.updatedData.range.slice(0, MAX_RANGE_LENGTH) } : {}),
      ...(payload.updatedData?.majorDimension === 'ROWS' || payload.updatedData?.majorDimension === 'COLUMNS' ? { majorDimension: payload.updatedData.majorDimension } : {}),
      values: updatedValues,
    };
  }

  async appendRows(
    spreadsheetIdValue: string,
    rangeValue: string,
    values: readonly (readonly unknown[])[],
    mode: GoogleSheetInputMode = 'literal',
    options: GoogleSheetsMutationOptions = {},
  ): Promise<GoogleSheetValuesResult> {
    const idValue = spreadsheetId(spreadsheetIdValue);
    const rangeText = a1Range(rangeValue);
    const safeValues = normalizeValues(values);
    const option = inputOption(mode);
    requireMutationCurrent(options, 'Google Sheets append');
    const access = await this.oauth.authorize('sheets.write');
    requireMutationCurrent(options, 'Google Sheets append');
    const id = encodeURIComponent(idValue);
    const range = encodeURIComponent(rangeText);
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}:append?valueInputOption=${option}&insertDataOption=INSERT_ROWS&includeValuesInResponse=true&responseValueRenderOption=UNFORMATTED_VALUE`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: safeValues }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Sheets append'));
    const payload = await this.readJson<{ updates?: { updatedRange?: unknown; updatedData?: { values?: unknown } } }>(response);
    const updatedValues = Array.isArray(payload.updates?.updatedData?.values)
      ? normalizeValues(payload.updates.updatedData.values.filter(Array.isArray) as readonly (readonly unknown[])[])
      : safeValues;
    return {
      trust: 'untrusted-external',
      source: 'sheets',
      ...(typeof payload.updates?.updatedRange === 'string' ? { range: payload.updates.updatedRange.slice(0, MAX_RANGE_LENGTH) } : {}),
      values: updatedValues,
    };
  }

  async updateCell(
    spreadsheetIdValue: string,
    rangeValue: string,
    value: unknown,
    mode: GoogleSheetInputMode = 'literal',
    options: GoogleSheetsMutationOptions = {},
  ): Promise<GoogleSheetValuesResult> {
    return this.writeRange(spreadsheetIdValue, rangeValue, [[normalizeCellValue(value)]], mode, options);
  }

  async exportSpreadsheet(
    spreadsheetIdValue: string,
    format: GoogleSheetsExportFormat,
    options: GoogleSheetsMutationOptions & { readonly maxBytes?: number } = {},
  ): Promise<GoogleSheetsExportResult> {
    const idValue = spreadsheetId(spreadsheetIdValue);
    const target = format === 'pdf'
      ? { mimeType: 'application/pdf', extension: '.pdf' as const }
      : format === 'xlsx'
        ? { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' as const }
        : undefined;
    if (!target) throw new Error('Google Sheets export format must be pdf or xlsx.');
    requireMutationCurrent(options, 'Google Sheets export');
    const access = await this.oauth.authorize('sheets.read');
    requireMutationCurrent(options, 'Google Sheets export');
    const response = await access.fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(idValue)}/export?mimeType=${encodeURIComponent(target.mimeType)}`,
      options.signal ? { signal: options.signal } : undefined,
      () => requireMutationCurrent(options, 'Google Sheets export'),
    );
    const content = await readBoundedGoogleContent(response, 'Google Sheets export', boundedGoogleTransferLimit(options.maxBytes), options.signal);
    return { format, mimeType: target.mimeType, extension: target.extension, bytes: content.bytes };
  }

  async createSpreadsheet(title: string, firstSheetTitle?: string, options: GoogleSheetsMutationOptions = {}): Promise<GoogleSpreadsheetSummary> {
    const safeTitle = requireText(title, 'spreadsheet title', MAX_TITLE_LENGTH);
    const safeFirstSheetTitle = firstSheetTitle === undefined ? undefined : requireText(firstSheetTitle, 'sheet title', MAX_SHEET_TITLE_LENGTH);
    const body = {
      properties: { title: safeTitle },
      ...(safeFirstSheetTitle ? { sheets: [{ properties: { title: safeFirstSheetTitle } }] } : {}),
    };
    requireMutationCurrent(options, 'Google Sheets create spreadsheet');
    const access = await this.oauth.authorize('sheets.write');
    requireMutationCurrent(options, 'Google Sheets create spreadsheet');
    const response = await access.fetch(SHEETS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Sheets create spreadsheet'));
    const payload = await this.readJson<SpreadsheetResponse>(response);
    return spreadsheetSummary(payload, undefined, safeTitle);
  }

  async addSheet(
    spreadsheetIdValue: string,
    title: string,
    rowCount = 1000,
    columnCount = 26,
    options: GoogleSheetsMutationOptions = {},
  ): Promise<{ spreadsheetId: string; driveFileId: string; sheetId: number; title: string; rowCount: number; columnCount: number }> {
    const idValue = spreadsheetId(spreadsheetIdValue);
    const safeTitle = requireText(title, 'sheet title', MAX_SHEET_TITLE_LENGTH);
    if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 100_000) throw new Error('Google Sheets row count is outside the application bounds.');
    if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > 1_000) throw new Error('Google Sheets column count is outside the application bounds.');
    requireMutationCurrent(options, 'Google Sheets add sheet');
    const access = await this.oauth.authorize('sheets.write');
    requireMutationCurrent(options, 'Google Sheets add sheet');
    const response = await access.fetch(`${SHEETS_API}/${encodeURIComponent(idValue)}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: safeTitle, gridProperties: { rowCount, columnCount } } } }],
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Sheets add sheet'));
    const payload = await this.readJson<{ replies?: unknown }>(response);
    const replies = Array.isArray(payload.replies) ? payload.replies : [];
    const first = replies[0] && typeof replies[0] === 'object' && !Array.isArray(replies[0]) ? replies[0] as Record<string, unknown> : {};
    const addSheet = first.addSheet && typeof first.addSheet === 'object' && !Array.isArray(first.addSheet) ? first.addSheet as Record<string, unknown> : {};
    const properties = addSheet.properties && typeof addSheet.properties === 'object' && !Array.isArray(addSheet.properties)
      ? addSheet.properties as Record<string, unknown>
      : {};
    if (!Number.isInteger(properties.sheetId)) throw new Error('Google Sheets response did not contain the new sheet ID.');
    return {
      spreadsheetId: idValue,
      driveFileId: idValue,
      sheetId: properties.sheetId as number,
      title: typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim().slice(0, MAX_SHEET_TITLE_LENGTH) : safeTitle,
      rowCount,
      columnCount,
    };
  }

  async insertRows(spreadsheetIdValue: string, sheetId: number, startIndex: number, count: number, options: GoogleSheetsMutationOptions = {}): Promise<unknown> {
    if (!Number.isInteger(sheetId) || sheetId < 0) throw new Error('Google Sheets sheet ID must be a non-negative integer.');
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 100_000) throw new Error('Google Sheets row start index is outside the application bounds.');
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Google Sheets row insert count is outside the application bounds.');
    return this.batchUpdate(spreadsheetIdValue, [{
      insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + count },
        inheritFromBefore: startIndex > 0,
      },
    }], options);
  }

  async batchUpdate(spreadsheetIdValue: string, requests: readonly Record<string, unknown>[], options: GoogleSheetsMutationOptions = {}): Promise<unknown> {
    const idValue = spreadsheetId(spreadsheetIdValue);
    const safeRequests = boundedBatchRequests(requests);
    requireMutationCurrent(options, 'Google Sheets structural update');
    const access = await this.oauth.authorize('sheets.write');
    requireMutationCurrent(options, 'Google Sheets structural update');
    const id = encodeURIComponent(idValue);
    const response = await access.fetch(`${SHEETS_API}/${id}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: safeRequests }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Sheets structural update'));
    return this.readJson(response);
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
}
