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
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
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
});
