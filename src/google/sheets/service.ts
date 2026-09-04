import type { GoogleOAuthAuthority } from '../oauth/contracts';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

interface SpreadsheetResponse {
  spreadsheetId?: unknown;
  properties?: unknown;
}

export interface GoogleSheetRange {
  range: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
}

export interface GoogleSheetValuesResult {
  range?: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values: readonly (readonly unknown[])[];
}

function requireText(value: string, field: string, maxLength = 500): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Sheets ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Sheets ${field} is too long.`);
  return normalized;
}

function spreadsheetId(id: string): string {
  return requireText(id, 'spreadsheet ID');
}

function a1Range(range: string): string {
  return requireText(range, 'A1 range', 500);
}

export class GoogleSheetsService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async getSpreadsheet(spreadsheetIdValue: string): Promise<SpreadsheetResponse> {
    const access = await this.oauth.authorize('sheets.read');
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const fields = encodeURIComponent('spreadsheetId,properties(spreadsheetId,title,locale,timeZone)');
    const response = await access.fetch(`${SHEETS_API}/${id}?fields=${fields}`);
    return this.readJson<SpreadsheetResponse>(response);
  }

  async readRange(spreadsheetIdValue: string, rangeValue: string): Promise<GoogleSheetValuesResult> {
    const access = await this.oauth.authorize('sheets.read');
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const range = encodeURIComponent(a1Range(rangeValue));
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}?majorDimension=ROWS`);
    const payload = await this.readJson<{ range?: unknown; majorDimension?: unknown; values?: unknown }>(response);
    return {
      ...(typeof payload.range === 'string' ? { range: payload.range } : {}),
      ...(payload.majorDimension === 'ROWS' || payload.majorDimension === 'COLUMNS' ? { majorDimension: payload.majorDimension } : {}),
      values: Array.isArray(payload.values) ? payload.values.filter(Array.isArray) as readonly (readonly unknown[])[] : [],
    };
  }

  async writeRange(spreadsheetIdValue: string, rangeValue: string, values: readonly (readonly unknown[])[]): Promise<GoogleSheetValuesResult> {
    if (!values.length) throw new Error('Google Sheets write requires at least one row.');
    if (values.length > 1000) throw new Error('Google Sheets write is limited to 1000 rows per operation.');
    const access = await this.oauth.authorize('sheets.write');
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const range = encodeURIComponent(a1Range(rangeValue));
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ range: rangeValue.trim(), majorDimension: 'ROWS', values }),
    });
    const payload = await this.readJson<{ updatedData?: { range?: unknown; majorDimension?: unknown; values?: unknown } }>(response);
    return {
      ...(typeof payload.updatedData?.range === 'string' ? { range: payload.updatedData.range } : {}),
      ...(payload.updatedData?.majorDimension === 'ROWS' || payload.updatedData?.majorDimension === 'COLUMNS' ? { majorDimension: payload.updatedData.majorDimension } : {}),
      values: Array.isArray(payload.updatedData?.values) ? payload.updatedData.values.filter(Array.isArray) as readonly (readonly unknown[])[] : [],
    };
  }

  async appendRows(spreadsheetIdValue: string, rangeValue: string, values: readonly (readonly unknown[])[]): Promise<GoogleSheetValuesResult> {
    if (!values.length) throw new Error('Google Sheets append requires at least one row.');
    if (values.length > 1000) throw new Error('Google Sheets append is limited to 1000 rows per operation.');
    const access = await this.oauth.authorize('sheets.write');
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const range = encodeURIComponent(a1Range(rangeValue));
    const response = await access.fetch(`${SHEETS_API}/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
    });
    const payload = await this.readJson<{ updates?: { updatedRange?: unknown; updatedRows?: unknown } }>(response);
    return {
      ...(typeof payload.updates?.updatedRange === 'string' ? { range: payload.updates.updatedRange } : {}),
      values,
    };
  }

  async batchUpdate(spreadsheetIdValue: string, requests: readonly Record<string, unknown>[]): Promise<unknown> {
    if (!requests.length) throw new Error('Google Sheets batch update requires at least one request.');
    if (requests.length > 100) throw new Error('Google Sheets batch update is limited to 100 requests per operation.');
    const access = await this.oauth.authorize('sheets.write');
    const id = encodeURIComponent(spreadsheetId(spreadsheetIdValue));
    const response = await access.fetch(`${SHEETS_API}/${id}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    return this.readJson(response);
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
}
