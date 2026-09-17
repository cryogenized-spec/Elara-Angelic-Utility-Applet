import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  updateFile: vi.fn(),
}));
const sheetsMocks = vi.hoisted(() => ({
  updateCell: vi.fn(),
  insertRows: vi.fn(),
}));

vi.mock('../drive/service', () => ({
  GoogleDriveService: class {
    updateFile = driveMocks.updateFile;
  },
}));

vi.mock('../sheets/service', () => ({
  GoogleSheetsService: class {
    updateCell = sheetsMocks.updateCell;
    insertRows = sheetsMocks.insertRows;
  },
}));

import { googleServiceToolHandlers } from './service-handlers';
import { googleToolRegistry } from './registry';
import { validateDriveSheetsToolArguments } from './drive-sheets-schemas';
import { googleGeminiFunctionDeclarations } from './gemini-declarations';
import { confirmationRequestForCall, type GoogleToolExecutionContext } from './executor';

function context(tool: GoogleToolExecutionContext['tool'], arguments_: Record<string, unknown>): GoogleToolExecutionContext {
  const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
  if (!descriptor) throw new Error(`Missing descriptor for ${tool}`);
  return {
    tool,
    descriptor,
    capability: descriptor.capability as GoogleToolExecutionContext['capability'],
    risk: descriptor.risk,
    arguments: arguments_,
  };
}

describe('Drive and Sheets executable parity', () => {
  beforeEach(() => {
    driveMocks.updateFile.mockReset();
    sheetsMocks.updateCell.mockReset();
    sheetsMocks.insertRows.mockReset();
  });

  it('executes the declared nested Drive metadata patch exactly', async () => {
    driveMocks.updateFile.mockResolvedValue({ id: 'file-1', name: 'Renamed' });
    const args = validateDriveSheetsToolArguments('drive.updateFile', {
      fileId: 'file-1',
      patch: { name: 'Renamed', starred: true },
    });
    const handler = googleServiceToolHandlers['drive.updateFile'];
    expect(handler).toBeTypeOf('function');

    await handler!(context('drive.updateFile', args));

    expect(driveMocks.updateFile).toHaveBeenCalledWith('file-1', { name: 'Renamed', starred: true });
  });

  it('requires a bounded string cell input in both schema and Gemini declaration', () => {
    expect(() => validateDriveSheetsToolArguments('sheets.updateCell', {
      spreadsheetId: 'sheet-1', range: 'Sheet1!B2',
    })).toThrow();
    expect(() => validateDriveSheetsToolArguments('sheets.updateCell', {
      spreadsheetId: 'sheet-1', range: 'Sheet1!B2', value: { unsafe: true },
    })).toThrow();
    expect(() => validateDriveSheetsToolArguments('sheets.updateCell', {
      spreadsheetId: 'sheet-1', range: 'Sheet1!B2', value: 'x'.repeat(50_001),
    })).toThrow();

    const declaration = googleGeminiFunctionDeclarations.find((entry) => entry.name === 'sheets.updateCell');
    expect(declaration?.parameters.required).toContain('value');
    expect(declaration?.parameters.properties.value).toMatchObject({ type: 'string', maxLength: 50_000 });
  });

  it('wires sheets.updateCell from validated model arguments to the existing service method', async () => {
    sheetsMocks.updateCell.mockResolvedValue({ range: 'Sheet1!B2', values: [['ready']] });
    const args = validateDriveSheetsToolArguments('sheets.updateCell', {
      spreadsheetId: 'sheet-1',
      range: 'Sheet1!B2',
      value: 'ready',
    });
    const handler = googleServiceToolHandlers['sheets.updateCell'];
    expect(handler).toBeTypeOf('function');

    await handler!(context('sheets.updateCell', args));

    expect(sheetsMocks.updateCell).toHaveBeenCalledWith('sheet-1', 'Sheet1!B2', 'ready');
  });

  it('wires sheets.insertRows from validated model arguments to the existing service method', async () => {
    sheetsMocks.insertRows.mockResolvedValue({ replies: [] });
    const args = validateDriveSheetsToolArguments('sheets.insertRows', {
      spreadsheetId: 'sheet-1',
      sheetId: 42,
      startIndex: 3,
      count: 2,
    });
    const handler = googleServiceToolHandlers['sheets.insertRows'];
    expect(handler).toBeTypeOf('function');

    await handler!(context('sheets.insertRows', args));

    expect(sheetsMocks.insertRows).toHaveBeenCalledWith('sheet-1', 42, 3, 2);
  });

  it('shows exact Sheets destinations and full single-cell input before approval', () => {
    const cellValue = `formula-or-text-${'x'.repeat(400)}`;
    const update = confirmationRequestForCall({
      tool: 'sheets.updateCell',
      arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!B2', value: cellValue },
    });
    const insert = confirmationRequestForCall({
      tool: 'sheets.insertRows',
      arguments: { spreadsheetId: 'sheet-1', sheetId: 42, startIndex: 3, count: 2 },
    });

    expect(update?.resourceSummary).toContain('Sheet1!B2');
    expect(update?.resourceSummary).toContain('sheet-1');
    expect(update?.reviewText).toBe(cellValue);
    expect(insert?.resourceSummary).toContain('sheet 42');
    expect(insert?.resourceSummary).toContain('sheet-1');
    expect(insert?.resourceSummary).toContain('zero-based row index 3');
    expect(insert?.resourceSummary).toContain('2 row');
  });
});
