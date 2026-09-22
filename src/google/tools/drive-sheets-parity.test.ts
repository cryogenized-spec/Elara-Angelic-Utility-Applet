import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../persistence/google-picker-admissions', () => ({
  assertGooglePickerFileAllowed: vi.fn(async () => undefined),
  filterRevokedGooglePickerFiles: vi.fn(async (files: readonly unknown[]) => [...files]),
}));

const driveMocks = vi.hoisted(() => ({
  updateFile: vi.fn(),
}));
const sheetsMocks = vi.hoisted(() => ({
  createSpreadsheet: vi.fn(),
  addSheet: vi.fn(),
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
    createSpreadsheet = sheetsMocks.createSpreadsheet;
    addSheet = sheetsMocks.addSheet;
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
    sheetsMocks.createSpreadsheet.mockReset();
    sheetsMocks.addSheet.mockReset();
    sheetsMocks.updateCell.mockReset();
    sheetsMocks.insertRows.mockReset();
  });

  it('executes the declared nested Drive metadata patch exactly and excludes trashing', async () => {
    driveMocks.updateFile.mockResolvedValue({ id: 'file-1', name: 'Renamed' });
    const args = validateDriveSheetsToolArguments('drive.updateFile', {
      fileId: 'file-1',
      etag: '"etag-1"',
      patch: { name: 'Renamed', starred: true },
    });
    expect(() => validateDriveSheetsToolArguments('drive.updateFile', {
      fileId: 'file-1',
      etag: '"etag-1"',
      patch: { trashed: true },
    })).toThrow();

    const handler = googleServiceToolHandlers['drive.updateFile'];
    expect(handler).toBeTypeOf('function');
    await handler!(context('drive.updateFile', args));

    expect(driveMocks.updateFile).toHaveBeenCalledWith('file-1', '"etag-1"', { name: 'Renamed', starred: true }, {});
  });

  it('rejects object cell input and keeps model-facing single-cell text bounded', () => {
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

  it('accepts only a single A1 cell target while preserving valid quoted sheet names', () => {
    for (const range of [
      'A1',
      "'My Sheet'!$B$2",
      "'January, 2026'!A1",
      "'Bang!'!A1",
      "'Bob''s Sheet'!$C$7",
    ]) {
      expect(validateDriveSheetsToolArguments('sheets.updateCell', {
        spreadsheetId: 'sheet-1', range, value: 'ready',
      })).toMatchObject({ range });
    }

    for (const range of ['Sheet1!A1:B2', 'A:A', '1:1', 'NamedRange', "'unterminated!A1", "''!A1"]) {
      expect(() => validateDriveSheetsToolArguments('sheets.updateCell', {
        spreadsheetId: 'sheet-1', range, value: 'ready',
      })).toThrow(/one A1 cell reference/i);
    }
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

    expect(sheetsMocks.updateCell).toHaveBeenCalledWith('sheet-1', 'Sheet1!B2', 'ready', 'literal', {});
  });

  it('wires sheets.insertRows and returns only a bounded semantic result', async () => {
    sheetsMocks.insertRows.mockResolvedValue({ replies: Array.from({ length: 10_000 }, () => ({ provider: 'noise' })) });
    const args = validateDriveSheetsToolArguments('sheets.insertRows', {
      spreadsheetId: 'sheet-1',
      sheetId: 42,
      startIndex: 3,
      count: 2,
    });
    const handler = googleServiceToolHandlers['sheets.insertRows'];
    expect(handler).toBeTypeOf('function');

    await expect(handler!(context('sheets.insertRows', args))).resolves.toEqual({
      inserted: true,
      spreadsheetId: 'sheet-1',
      sheetId: 42,
      startIndex: 3,
      count: 2,
    });
    expect(sheetsMocks.insertRows).toHaveBeenCalledWith('sheet-1', 42, 3, 2, {});
  });

  it('wires spreadsheet and sheet creation through bounded semantic handlers', async () => {
    sheetsMocks.createSpreadsheet.mockResolvedValue({ spreadsheetId: 'sheet-1', driveFileId: 'sheet-1', title: 'Budget', sheets: [] });
    sheetsMocks.addSheet.mockResolvedValue({ spreadsheetId: 'sheet-1', driveFileId: 'sheet-1', sheetId: 7, title: 'Summary', rowCount: 1000, columnCount: 26 });

    const create = googleServiceToolHandlers['sheets.createSpreadsheet'];
    const add = googleServiceToolHandlers['sheets.addSheet'];
    expect(create).toBeTypeOf('function');
    expect(add).toBeTypeOf('function');

    await create!(context('sheets.createSpreadsheet', { title: 'Budget', firstSheetTitle: 'Sheet1' }));
    await add!(context('sheets.addSheet', { spreadsheetId: 'sheet-1', title: 'Summary' }));

    expect(sheetsMocks.createSpreadsheet).toHaveBeenCalledWith('Budget', 'Sheet1', {});
    expect(sheetsMocks.addSheet).toHaveBeenCalledWith('sheet-1', 'Summary', 1000, 26, {});
    const createDeclaration = googleGeminiFunctionDeclarations.find((entry) => entry.name === 'sheets.createSpreadsheet');
    const addDeclaration = googleGeminiFunctionDeclarations.find((entry) => entry.name === 'sheets.addSheet');
    expect(createDeclaration?.parameters.required).toContain('title');
    expect(addDeclaration?.parameters.required).toEqual(expect.arrayContaining(['spreadsheetId', 'title']));
  });

  it('passes explicit USER_ENTERED mode only when requested', async () => {
    sheetsMocks.updateCell.mockResolvedValue({ range: 'Sheet1!A1', values: [['=1+2']] });
    const handler = googleServiceToolHandlers['sheets.updateCell'];
    await handler!(context('sheets.updateCell', {
      spreadsheetId: 'sheet-1',
      range: 'Sheet1!A1',
      value: '=1+2',
      inputMode: 'userEntered',
    }));
    expect(sheetsMocks.updateCell).toHaveBeenCalledWith('sheet-1', 'Sheet1!A1', '=1+2', 'userEntered', {});
    const confirmation = confirmationRequestForCall({
      tool: 'sheets.updateCell',
      arguments: { spreadsheetId: 'sheet-1', range: 'Sheet1!A1', value: '=1+2', inputMode: 'userEntered' },
    });
    expect(confirmation?.resourceSummary).toContain('USER_ENTERED');
    expect(confirmation?.resourceSummary).toContain('formulas');
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
    expect(insert?.resourceSummary).toContain('starting at row 4');
    expect(insert?.resourceSummary).toContain('2 row');
  });
});
