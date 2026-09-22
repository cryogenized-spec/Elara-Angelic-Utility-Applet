import { describe, expect, it } from 'vitest';
import { validateDriveSheetsToolArguments } from './drive-sheets-schemas';

describe('Drive/Sheets adversarial schema bounds', () => {
  it('rejects pathologically deep batchUpdate request trees before confirmation formatting', () => {
    let nested: unknown = { value: 1 };
    for (let depth = 0; depth < 30; depth += 1) nested = { nested };
    expect(() => validateDriveSheetsToolArguments('sheets.batchUpdate', {
      spreadsheetId: 'sheet-1',
      requests: [{ updateCells: nested }],
    })).toThrow(/nesting is too deep/i);
  });

  it('rejects oversized serialized batchUpdate payloads before provider or confirmation work', () => {
    expect(() => validateDriveSheetsToolArguments('sheets.batchUpdate', {
      spreadsheetId: 'sheet-1',
      requests: [{ updateCells: { payload: 'x'.repeat(1_000_000) } }],
    })).toThrow(/request limit/i);
  });

  it('retains normal bounded structural batch updates', () => {
    expect(validateDriveSheetsToolArguments('sheets.batchUpdate', {
      spreadsheetId: 'sheet-1',
      requests: [{ insertDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: 2, endIndex: 3 } } }],
    })).toMatchObject({ spreadsheetId: 'sheet-1' });
  });
});
