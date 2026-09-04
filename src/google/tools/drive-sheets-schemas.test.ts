import { describe, expect, it } from 'vitest';
import { validateDriveSheetsToolArguments } from './drive-sheets-schemas';

describe('Drive and Sheets tool argument schemas', () => {
  it('accepts bounded Drive search arguments', () => {
    expect(validateDriveSheetsToolArguments('drive.searchFiles', { query: "name contains 'Plan'", pageSize: 25 })).toMatchObject({ pageSize: 25 });
  });

  it('rejects arbitrary Drive search fields', () => {
    expect(() => validateDriveSheetsToolArguments('drive.searchFiles', { url: 'https://example.com' })).toThrow();
  });

  it('accepts bounded Sheet range writes', () => {
    expect(validateDriveSheetsToolArguments('sheets.writeRange', {
      spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B2', values: [['a', 'b'], ['c', 'd']],
    })).toMatchObject({ spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B2' });
  });

  it('rejects oversized Sheet writes', () => {
    const values = Array.from({ length: 1001 }, () => ['x']);
    expect(() => validateDriveSheetsToolArguments('sheets.writeRange', { spreadsheetId: 'sheet-1', range: 'Sheet1!A:A', values })).toThrow();
  });

  it('requires at least one Drive update field', () => {
    expect(() => validateDriveSheetsToolArguments('drive.updateFile', { fileId: 'file-1', patch: {} })).toThrow();
  });
});
