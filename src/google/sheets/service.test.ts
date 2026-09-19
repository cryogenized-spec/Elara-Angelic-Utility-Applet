import { describe, expect, it } from 'vitest';
import { GoogleSheetsService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function makeOAuth(calls: string[]): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({
      capability,
      fetch: async (input, init) => {
        calls.push(`${capability}:${init?.method ?? 'GET'}:${String(input)}`);
        if (String(input).includes('/values/') && (init?.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify({ range: 'Sheet1!A1:B2', majorDimension: 'ROWS', values: [['a', 'b'], ['c', 'd']] }), { status: 200 });
        }
        if ((init?.method ?? 'GET') === 'POST' && String(input).includes(':batchUpdate')) {
          return new Response(JSON.stringify({ replies: [] }), { status: 200 });
        }
        if ((init?.method ?? 'GET') === 'POST' && String(input).includes(':append')) {
          return new Response(JSON.stringify({ updates: { updatedRange: 'Sheet1!A1:B2', updatedRows: 2 } }), { status: 200 });
        }
        return new Response(JSON.stringify({ updatedData: { range: 'Sheet1!A1:B2', majorDimension: 'ROWS', values: [['a', 'b'], ['c', 'd']] } }), { status: 200 });
      },
    }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}

describe('GoogleSheetsService', () => {
  it('keeps reads and writes on separate capabilities', async () => {
    const calls: string[] = [];
    const service = new GoogleSheetsService(makeOAuth(calls));
    await expect(service.readRange('sheet-1', 'Sheet1!A1:B2')).resolves.toMatchObject({ range: 'Sheet1!A1:B2' });
    await expect(service.writeRange('sheet-1', 'Sheet1!A1:B2', [['a', 'b']])).resolves.toMatchObject({ range: 'Sheet1!A1:B2' });
    expect(calls.some((call) => call.startsWith('sheets.read:'))).toBe(true);
    expect(calls.some((call) => call.startsWith('sheets.write:'))).toBe(true);
  });

  it('rejects empty writes', async () => {
    const service = new GoogleSheetsService(makeOAuth([]));
    await expect(service.writeRange('sheet-1', 'Sheet1!A1', [])).rejects.toThrow('at least one row');
  });

  it('rejects empty batch updates', async () => {
    const service = new GoogleSheetsService(makeOAuth([]));
    await expect(service.batchUpdate('sheet-1', [])).rejects.toThrow('at least one request');
  });

  it('limits write batches to bounded sizes', async () => {
    const service = new GoogleSheetsService(makeOAuth([]));
    const rows = Array.from({ length: 1001 }, () => ['x']);
    await expect(service.writeRange('sheet-1', 'Sheet1!A:A', rows)).rejects.toThrow('limited to 1000 rows');
  });

  it('writes formula-looking text literally by default and only parses when explicitly requested', async () => {
    const calls: string[] = [];
    const service = new GoogleSheetsService(makeOAuth(calls));

    await service.updateCell('sheet-1', 'Sheet1!A1', '=1+2');
    expect(calls.some((call) => call.includes('valueInputOption=RAW'))).toBe(true);

    calls.length = 0;
    await service.updateCell('sheet-1', 'Sheet1!A1', '=1+2', 'userEntered');
    expect(calls.some((call) => call.includes('valueInputOption=USER_ENTERED'))).toBe(true);
  });

  it('rejects non-primitive and oversized cell batches before authorization', async () => {
    let authorizeCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorizeCalls += 1;
        return { capability, fetch: async () => new Response('{}', { status: 200 }) };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleSheetsService(oauth);
    await expect(service.writeRange('sheet-1', 'Sheet1!A1', [[{ unsafe: true }]])).rejects.toThrow(/strings, finite numbers, booleans, or null/i);
    await expect(service.writeRange('sheet-1', 'Sheet1!A1', [Array.from({ length: 101 }, () => 'x')])).rejects.toThrow(/100 cells/i);
    const cells = Array.from({ length: 101 }, () => Array.from({ length: 100 }, () => 'x'));
    await expect(service.writeRange('sheet-1', 'Sheet1!A1', cells)).rejects.toThrow(/10,000 cells/i);
    expect(authorizeCalls).toBe(0);
  });

  it('creates a spreadsheet with stable Drive identity and a bounded first sheet', async () => {
    let body: unknown;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (_input, init) => {
          body = init?.body ? JSON.parse(String(init.body)) : null;
          return new Response(JSON.stringify({
            spreadsheetId: 'spreadsheet-1',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spreadsheet-1/edit',
            properties: { title: 'Budget' },
            sheets: [{ properties: { sheetId: 7, title: 'Summary', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } } }],
          }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleSheetsService(oauth);
    await expect(service.createSpreadsheet('Budget', 'Summary')).resolves.toMatchObject({
      spreadsheetId: 'spreadsheet-1',
      driveFileId: 'spreadsheet-1',
      title: 'Budget',
      sheets: [{ sheetId: 7, title: 'Summary' }],
    });
    expect(body).toEqual({ properties: { title: 'Budget' }, sheets: [{ properties: { title: 'Summary' } }] });
  });

  it('blocks a stale generation immediately before the real Sheets provider write', async () => {
    let providerCalls = 0;
    let active = true;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (_input, _init, beforeProviderFetch) => {
          active = false;
          await beforeProviderFetch?.();
          providerCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleSheetsService(oauth);
    await expect(service.updateCell('sheet-1', 'A1', 'x', 'literal', { isGenerationActive: () => active })).rejects.toThrow(/lost turn authority/i);
    expect(providerCalls).toBe(0);
  });

  it('exports only fixed Sheets formats through the bounded Drive export endpoint', async () => {
    let requestedUrl = '';
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (input) => {
          requestedUrl = String(input);
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-length': '3' } });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleSheetsService(oauth);
    await expect(service.exportSpreadsheet('sheet-1', 'xlsx')).resolves.toMatchObject({
      format: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: '.xlsx',
    });
    expect(requestedUrl).toContain('/drive/v3/files/sheet-1/export?');
    expect(decodeURIComponent(requestedUrl)).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
});
